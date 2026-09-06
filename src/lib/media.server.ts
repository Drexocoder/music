/**
 * Server-only media helpers: YouTube search + local yt-dlp downloader.
 * Never import this from client components.
 */

import { createReadStream } from "node:fs";
import {
  mkdtemp,
  readdir,
  rm,
  stat,
} from "node:fs/promises";
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
    title?: {
      runs?: Array<{ text?: string }>;
    };
    ownerText?: {
      runs?: Array<{ text?: string }>;
    };
    lengthText?: {
      simpleText?: string;
    };
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
    if (
      out.length >= 30 ||
      !node ||
      typeof node !== "object"
    ) {
      return;
    }

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
          channel:
            vr.ownerText?.runs?.[0]?.text ??
            "YouTube",
          thumbnail:
            `https://i.ytimg.com/vi/${vr.videoId}/hqdefault.jpg`,
          ...(vr.lengthText?.simpleText
            ? {
                duration:
                  vr.lengthText.simpleText,
              }
            : {}),
        });
      }
    }

    Object.values(
      node as Record<string, unknown>,
    ).forEach(walk);
  };

  walk(data);

  const seen = new Set<string>();

  return out.filter((r) =>
    seen.has(r.id)
      ? false
      : (seen.add(r.id), true),
  );
}

export function extractVideoId(
  input: string,
): string | null {
  const raw = input.trim();

  if (/^[\w-]{11}$/.test(raw)) {
    return raw;
  }

  try {
    const url = new URL(raw);

    if (url.hostname.includes("youtu.be")) {
      const id = url.pathname
        .slice(1)
        .split("/")[0];

      return id && /^[\w-]{11}$/.test(id)
        ? id
        : null;
    }

    const v = url.searchParams.get("v");

    if (v && /^[\w-]{11}$/.test(v)) {
      return v;
    }

    const parts = url.pathname.split("/");
    const last = parts[parts.length - 1];

    return last && /^[\w-]{11}$/.test(last)
      ? last
      : null;
  } catch {
    return null;
  }
}

export async function ytSearch(
  q: string,
): Promise<{
  results: MediaResult[];
  error?: string;
}> {
  const apiKey =
    process.env["YOUTUBE_API_KEY"];

  if (apiKey) {
    const url = new URL(
      "https://www.googleapis.com/youtube/v3/search",
    );

    url.searchParams.set("part", "snippet");
    url.searchParams.set("type", "video");
    url.searchParams.set("videoEmbeddable", "true");
    url.searchParams.set("maxResults", "25");
    url.searchParams.set("q", q);
    url.searchParams.set("key", apiKey);

    try {
      const res = await fetch(url);

      if (res.ok) {
        const json =
          (await res.json()) as {
            items?: Array<{
              id?: {
                videoId?: string;
              };
              snippet?: {
                title?: string;
                channelTitle?: string;
                thumbnails?: {
                  high?: {
                    url?: string;
                  };
                };
              };
            }>;
          };

        const results =
          (json.items ?? [])
            .filter(
              (i) => i.id?.videoId,
            )
            .map((i) => ({
              id: i.id!.videoId!,
              title:
                i.snippet?.title ??
                "Untitled",
              channel:
                i.snippet?.channelTitle ??
                "YouTube",
              thumbnail:
                i.snippet?.thumbnails?.high
                  ?.url ??
                `https://i.ytimg.com/vi/${i.id!.videoId!}/hqdefault.jpg`,
            }));

        if (results.length) {
          return { results };
        }
      }
    } catch {
      // Continue to fallback search.
    }
  }

  const inner = await innertubeSearch(q);

  if (inner.length) {
    return {
      results: inner,
    };
  }

  try {
    const res = await fetch(
      `https://www.youtube.com/results?search_query=${encodeURIComponent(
        q,
      )}&sp=EgIQAQ%253D%253D`,
      {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
          "accept-language":
            "en-US,en;q=0.9",
        },
      },
    );

    if (!res.ok) {
      return {
        results: [],
        error:
          "Search is unavailable right now.",
      };
    }

    const results = scrape(await res.text());

    if (!results.length) {
      return {
        results: [],
        error: "No results found.",
      };
    }

    return {
      results,
    };
  } catch {
    return {
      results: [],
      error:
        "Search is unavailable right now.",
    };
  }
}

/**
 * Keyless YouTube search through
 * the public Innertube endpoint.
 */
async function innertubeSearch(
  q: string,
): Promise<MediaResult[]> {
  try {
    const res = await fetch(
      "https://www.youtube.com/youtubei/v1/search?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8&prettyPrint=false",
      {
        method: "POST",
        headers: {
          "content-type":
            "application/json",
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
        },
        body: JSON.stringify({
          query: q,
          params: "EgIQAQ%3D%3D",
          context: {
            client: {
              clientName: "WEB",
              clientVersion:
                "2.20240401.00.00",
              hl: "en",
              gl: "US",
            },
          },
        }),
      },
    );

    if (!res.ok) return [];

    const json =
      (await res.json()) as unknown;

    const out: MediaResult[] = [];

    const walk = (node: unknown) => {
      if (
        out.length >= 30 ||
        !node ||
        typeof node !== "object"
      ) {
        return;
      }

      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }

      const vr =
        (node as YtRenderer).videoRenderer;

      if (vr?.videoId) {
        const title =
          vr.title?.runs?.[0]?.text;

        if (title) {
          out.push({
            id: vr.videoId,
            title,
            channel:
              vr.ownerText?.runs?.[0]?.text ??
              "YouTube",
            thumbnail:
              `https://i.ytimg.com/vi/${vr.videoId}/hqdefault.jpg`,
            ...(vr.lengthText?.simpleText
              ? {
                  duration:
                    vr.lengthText.simpleText,
                }
              : {}),
          });
        }
      }

      Object.values(
        node as Record<string, unknown>,
      ).forEach(walk);
    };

    walk(json);

    const seen = new Set<string>();

    return out.filter((r) =>
      seen.has(r.id)
        ? false
        : (seen.add(r.id), true),
    );
  } catch {
    return [];
  }
}

export async function ytMeta(
  videoId: string,
): Promise<MediaResult | null> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
    );

    if (!res.ok) return null;

    const json =
      (await res.json()) as {
        title?: string;
        author_name?: string;
      };

    return {
      id: videoId,
      title:
        json.title ?? videoId,
      channel:
        json.author_name ??
        "YouTube",
      thumbnail:
        `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    };
  } catch {
    return null;
  }
}

/**
 * The local Python downloader only exists on Replit/local dev, where it
 * runs beside the frontend. It must be opted into explicitly: on serverless
 * hosts (Vercel, Cloudflare) localhost is the frontend itself, so probing it
 * makes the app call its own /api/download route and fail with a 502.
 */
function localDownloaderEnabled(): boolean {
  const configured =
    process.env["DOWNLOAD_LOCAL_ENABLED"]
      ?.trim()
      .toLowerCase();

  return (
    configured === "true" ||
    configured === "1"
  );
}

export function providerConfigured(): boolean {
  return (
    Boolean(
      process.env["DOWNLOAD_API_URL"],
    ) ||
    localDownloaderEnabled()
  );
}

async function fetchLocalMedia(
  videoId: string,
  type: "audio" | "video",
): Promise<Response | null> {
  if (!localDownloaderEnabled()) {
    return null;
  }

  return fetchDownloader(
    "http://127.0.0.1:8080",
    videoId,
    type,
    false,
  );
}


async function fetchDownloader(
  base: string,
  videoId: string,
  type: "audio" | "video",
  useVercelRewrite = false,
): Promise<Response | null> {
  const key =
    process.env["DOWNLOAD_API_KEY"] ?? "";

  try {
    const normalizedBase = base
      .trim()
      .replace(/\/+$/, "");

    const url = useVercelRewrite
      ? new URL(
          `/api/download/${encodeURIComponent(videoId)}`,
          normalizedBase.startsWith("http")
            ? normalizedBase
            : `https://${normalizedBase}`,
        )
      : new URL(
          "/download",
          normalizedBase.startsWith("http")
            ? normalizedBase
            : `https://${normalizedBase}`,
        );

    url.searchParams.set(
      "type",
      type,
    );

    const res =
      await fetch(url, {
        headers: {
          accept: "*/*",
          ...(key
            ? { "x-api-key": key }
            : {}),
        },
        cache: "no-store",
      });

    if (
      res.ok &&
      res.body
    ) {
      return res;
    }

    let details = "";
    try {
      details = await res.text();
    } catch {
      // Ignore response-body parsing errors.
    }

    console.error(
      `[media] Downloader returned ${res.status}${details ? `: ${details.slice(0, 500)}` : ""}`,
    );
  } catch (error) {
    console.error(
      "[media] Downloader failed:",
      error,
    );
  }

  return null;
}

type FetchMediaOptions = {
  /**
   * The public app origin. On Vercel this lets the frontend server function
   * reach the separate `/api/download` container through the configured
   * rewrite instead of falling back to an unrelated public mirror.
   */
  downloaderOrigin?: string;
};

const PIPED_INSTANCES = [
  "https://pipedapi.kavin.rocks",
  "https://pipedapi.adminforge.de",
  "https://api.piped.private.coffee",
  "https://pipedapi.reallyaweso.me",
];

type PipedStream = {
  url?: string;
  mimeType?: string;
  bitrate?: number;
  quality?: string;
  videoOnly?: boolean;
};

export type ResolvedStream = {
  url: string;
  mimeType: string;
};

/**
 * Keyless stream resolver: asks public Piped instances for the direct
 * googlevideo stream URL. Runs anywhere (no yt-dlp, no ffmpeg, no disk).
 */
export async function resolveStream(
  videoId: string,
  type: "audio" | "video",
): Promise<ResolvedStream | null> {
  for (const instance of PIPED_INSTANCES) {
    try {
      const res = await fetch(
        `${instance}/streams/${videoId}`,
        {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(8000),
        },
      );

      if (!res.ok) continue;

      const json = (await res.json()) as {
        audioStreams?: PipedStream[];
        videoStreams?: PipedStream[];
      };

      if (type === "audio") {
        const best = (json.audioStreams ?? [])
          .filter((s) => s.url)
          .sort(
            (a, b) =>
              (b.bitrate ?? 0) - (a.bitrate ?? 0),
          )[0];

        if (best?.url) {
          return {
            url: best.url,
            mimeType:
              best.mimeType ?? "audio/mp4",
          };
        }

        continue;
      }

      const best = (json.videoStreams ?? [])
        .filter(
          (s) =>
            s.url &&
            !s.videoOnly &&
            (s.mimeType ?? "").includes("mp4"),
        )
        .sort(
          (a, b) =>
            parseInt(b.quality ?? "0", 10) -
            parseInt(a.quality ?? "0", 10),
        )[0];

      if (best?.url) {
        return {
          url: best.url,
          mimeType: best.mimeType ?? "video/mp4",
        };
      }
    } catch (error) {
      console.error(
        `[media] Stream resolver ${instance} failed:`,
        error,
      );
    }
  }

  return null;
}

/**
 * Download media through:
 *
 * 1. Explicit DOWNLOAD_API_URL when configured.
 * 2. The local Python downloader when opted in (Replit/local dev).
 * 3. Keyless public stream resolver (works on serverless hosts).
 */
export async function fetchMedia(
  videoId: string,
  type: "audio" | "video",
  options: FetchMediaOptions = {},
): Promise<Response | null> {
  const base =
    process.env["DOWNLOAD_API_URL"]?.trim();

  if (base) {
    const response =
      await fetchDownloader(
        base,
        videoId,
        type,
        false,
      );

    if (response) {
      return response;
    }
  }

  const local = await fetchLocalMedia(
    videoId,
    type,
  );

  if (local) {
    return local;
  }

  if (options.downloaderOrigin) {
    const deployed = await fetchDownloader(
      options.downloaderOrigin,
      videoId,
      type,
      true,
    );

    if (deployed) {
      return deployed;
    }
  }

  const stream = await resolveStream(
    videoId,
    type,
  );

  if (!stream) {
    return null;
  }

  try {
    const res = await fetch(stream.url, {
      headers: { accept: "*/*" },
      cache: "no-store",
    });

    if (res.ok && res.body) {
      return res;
    }

    console.error(
      `[media] Stream fetch returned ${res.status}`,
    );
  } catch (error) {
    console.error(
      "[media] Stream fetch failed:",
      error,
    );
  }

  return null;
}


export function safeFileName(
  title: string,
  ext: string,
): string {
  const clean =
    title
      .replace(
        /[^\w\s.-]/g,
        "",
      )
      .trim()
      .slice(0, 80) ||
    "track";

  return `${clean}.${ext}`;
}
