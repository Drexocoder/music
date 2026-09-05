/**
 * Server-only media helpers: YouTube search + download provider proxy.
 * Never import this from client components.
 */

import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

export type MediaResult = {
  id: string;
  title: string;
  channel: string;
  thumbnail: string;
  duration?: string;
};

type YtRenderer = {
  videoRenderer?: {
    videoId?: string;
    title?: { runs?: Array<{ text?: string }> };
    ownerText?: { runs?: Array<{ text?: string }> };
    lengthText?: { simpleText?: string };
  };
};

function scrape(html: string): MediaResult[] {
  const marker = "var ytInitialData = ";
  const start = html.indexOf(marker);
  if (start === -1) return [];
  const from = start + marker.length;
  const end = html.indexOf("};", from);
  if (end === -1) return [];
  let data: unknown;
  try {
    data = JSON.parse(html.slice(from, end + 1));
  } catch {
    return [];
  }

  const out: MediaResult[] = [];
  const walk = (node: unknown) => {
    if (out.length >= 30 || !node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const vr = (node as YtRenderer).videoRenderer;
    if (vr?.videoId) {
      const title = vr.title?.runs?.[0]?.text;
      if (title) {
        out.push({
          id: vr.videoId,
          title,
          channel: vr.ownerText?.runs?.[0]?.text ?? "YouTube",
          thumbnail: `https://i.ytimg.com/vi/${vr.videoId}/hqdefault.jpg`,
          ...(vr.lengthText?.simpleText ? { duration: vr.lengthText.simpleText } : {}),
        });
      }
    }
    Object.values(node as Record<string, unknown>).forEach(walk);
  };
  walk(data);

  const seen = new Set<string>();
  return out.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
}

export function extractVideoId(input: string): string | null {
  const raw = input.trim();
  if (/^[\w-]{11}$/.test(raw)) return raw;
  try {
    const url = new URL(raw);
    if (url.hostname.includes("youtu.be")) {
      const id = url.pathname.slice(1).split("/")[0];
      return id && /^[\w-]{11}$/.test(id) ? id : null;
    }
    const v = url.searchParams.get("v");
    if (v && /^[\w-]{11}$/.test(v)) return v;
    const parts = url.pathname.split("/");
    const last = parts[parts.length - 1];
    return last && /^[\w-]{11}$/.test(last) ? last : null;
  } catch {
    return null;
  }
}

export async function ytSearch(q: string): Promise<{ results: MediaResult[]; error?: string }> {
  const apiKey = process.env["YOUTUBE_API_KEY"];
  if (apiKey) {
    const url = new URL("https://www.googleapis.com/youtube/v3/search");
    url.searchParams.set("part", "snippet");
    url.searchParams.set("type", "video");
    url.searchParams.set("videoEmbeddable", "true");
    url.searchParams.set("maxResults", "25");
    url.searchParams.set("q", q);
    url.searchParams.set("key", apiKey);
    try {
      const res = await fetch(url);
      if (res.ok) {
        const json = (await res.json()) as {
          items?: Array<{
            id?: { videoId?: string };
            snippet?: {
              title?: string;
              channelTitle?: string;
              thumbnails?: { high?: { url?: string } };
            };
          }>;
        };
        const results = (json.items ?? [])
          .filter((i) => i.id?.videoId)
          .map((i) => ({
            id: i.id!.videoId!,
            title: i.snippet?.title ?? "Untitled",
            channel: i.snippet?.channelTitle ?? "YouTube",
            thumbnail:
              i.snippet?.thumbnails?.high?.url ??
              `https://i.ytimg.com/vi/${i.id!.videoId!}/hqdefault.jpg`,
          }));
        if (results.length) return { results };
      }
    } catch {
      /* fall through to scrape */
    }
  }

  const inner = await innertubeSearch(q);
  if (inner.length) return { results: inner };

  try {
    const res = await fetch(
      `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=EgIQAQ%253D%253D`,
      {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          "accept-language": "en-US,en;q=0.9",
        },
      },
    );
    if (!res.ok) return { results: [], error: "Search is unavailable right now." };
    const results = scrape(await res.text());
    if (!results.length) return { results: [], error: "No results found." };
    return { results };
  } catch {
    return { results: [], error: "Search is unavailable right now." };
  }
}

/** Keyless YouTube search through the public innertube endpoint (most reliable from servers). */
async function innertubeSearch(q: string): Promise<MediaResult[]> {
  try {
    const res = await fetch(
      "https://www.youtube.com/youtubei/v1/search?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8&prettyPrint=false",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        },
        body: JSON.stringify({
          query: q,
          params: "EgIQAQ%3D%3D",
          context: {
            client: {
              clientName: "WEB",
              clientVersion: "2.20240401.00.00",
              hl: "en",
              gl: "US",
            },
          },
        }),
      },
    );
    if (!res.ok) return [];
    const json = (await res.json()) as unknown;
    const out: MediaResult[] = [];
    const walk = (node: unknown) => {
      if (out.length >= 30 || !node || typeof node !== "object") return;
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      const vr = (node as YtRenderer).videoRenderer;
      if (vr?.videoId) {
        const title = vr.title?.runs?.[0]?.text;
        if (title) {
          out.push({
            id: vr.videoId,
            title,
            channel: vr.ownerText?.runs?.[0]?.text ?? "YouTube",
            thumbnail: `https://i.ytimg.com/vi/${vr.videoId}/hqdefault.jpg`,
            ...(vr.lengthText?.simpleText ? { duration: vr.lengthText.simpleText } : {}),
          });
        }
      }
      Object.values(node as Record<string, unknown>).forEach(walk);
    };
    walk(json);
    const seen = new Set<string>();
    return out.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
  } catch {
    return [];
  }
}


export async function ytMeta(videoId: string): Promise<MediaResult | null> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { title?: string; author_name?: string };
    return {
      id: videoId,
      title: json.title ?? videoId,
      channel: json.author_name ?? "YouTube",
      thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    };
  } catch {
    return null;
  }
}

function localDownloaderEnabled(): boolean {
  const configured = process.env["DOWNLOAD_LOCAL_ENABLED"]?.trim().toLowerCase();
  if (configured === "false" || configured === "0") return false;
  if (configured === "true" || configured === "1") return true;
  return !process.env["VERCEL"];
}

/** A remote provider is optional; non-Vercel runtimes can use local yt-dlp. */
export function providerConfigured(): boolean {
  return Boolean(process.env["DOWNLOAD_API_URL"]) || localDownloaderEnabled();
}

async function fetchLocalMedia(videoId: string, type: "audio" | "video"): Promise<Response | null> {
  const directory = await mkdtemp(join(tmpdir(), "aurora-media-"));
  const output = join(directory, "media.%(ext)s");
  const target = `https://www.youtube.com/watch?v=${videoId}`;
  const args =
    type === "audio"
      ? [
          "run",
          "yt-dlp",
          "--no-playlist",
          "--no-progress",
          "--no-warnings",
          "--extract-audio",
          "--audio-format",
          "mp3",
          "--audio-quality",
          "5",
          "--output",
          output,
          target,
        ]
      : [
          "run",
          "yt-dlp",
          "--no-playlist",
          "--no-progress",
          "--no-warnings",
          "--format",
          "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
          "--merge-output-format",
          "mp4",
          "--output",
          output,
          target,
        ];

  try {
    const stderr: Buffer[] = [];
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const child = spawn("uv", args, { stdio: ["ignore", "ignore", "pipe"] });
      child.stderr.on("data", (chunk: Buffer) => {
        if (stderr.reduce((total, part) => total + part.length, 0) < 16_384) stderr.push(chunk);
      });
      child.once("error", reject);
      child.once("close", resolve);
    });
    if (exitCode !== 0) {
      console.error(`[media] yt-dlp failed (${exitCode}): ${Buffer.concat(stderr).toString("utf8")}`);
      await rm(directory, { recursive: true, force: true });
      return null;
    }

    const fileName = (await readdir(directory)).find((name) => name.startsWith("media."));
    if (!fileName) {
      await rm(directory, { recursive: true, force: true });
      return null;
    }
    const filePath = join(directory, fileName);
    const fileStat = await stat(filePath);
    const stream = createReadStream(filePath);
    const cleanup = () => void rm(directory, { recursive: true, force: true });
    stream.once("close", cleanup);
    stream.once("error", cleanup);

    return new Response(Readable.toWeb(stream) as ReadableStream, {
      headers: {
        "content-type": type === "audio" ? "audio/mpeg" : "video/mp4",
        "content-length": String(fileStat.size),
      },
    });
  } catch (error) {
    console.error("[media] Local downloader failed:", error);
    await rm(directory, { recursive: true, force: true });
    return null;
  }
}

/**
 * Streams the media file from the configured upstream provider.
 * Returns null when the provider is missing or fails.
 */
export async function fetchMedia(
  videoId: string,
  type: "audio" | "video",
): Promise<Response | null> {
  const base = process.env["DOWNLOAD_API_URL"];
  if (!base) return localDownloaderEnabled() ? fetchLocalMedia(videoId, type) : null;
  const key = process.env["DOWNLOAD_API_KEY"] ?? "";
  const url = new URL("/download", base.startsWith("http") ? base : `https://${base}`);
  url.searchParams.set("url", videoId);
  url.searchParams.set("type", type);
  if (key) url.searchParams.set("api_key", key);
  try {
    const res = await fetch(url, { headers: { accept: "*/*" } });
    if (!res.ok || !res.body) return null;
    return res;
  } catch {
    return null;
  }
}

export function safeFileName(title: string, ext: string): string {
  const clean = title.replace(/[^\w\s.-]/g, "").trim().slice(0, 80) || "track";
  return `${clean}.${ext}`;
}
