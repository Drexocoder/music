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
import youtubedl from "youtube-dl-exec";

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
    data = JSON.parse(
      html.slice(from, end + 1),
    );
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

    const vr = (
      node as YtRenderer
    ).videoRenderer;

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

    if (
      url.hostname.includes(
        "youtu.be",
      )
    ) {
      const id = url.pathname
        .slice(1)
        .split("/")[0];

      return id &&
        /^[\w-]{11}$/.test(id)
        ? id
        : null;
    }

    const v =
      url.searchParams.get("v");

    if (
      v &&
      /^[\w-]{11}$/.test(v)
    ) {
      return v;
    }

    const parts =
      url.pathname.split("/");

    const last =
      parts[parts.length - 1];

    return last &&
      /^[\w-]{11}$/.test(last)
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

    url.searchParams.set(
      "part",
      "snippet",
    );

    url.searchParams.set(
      "type",
      "video",
    );

    url.searchParams.set(
      "videoEmbeddable",
      "true",
    );

    url.searchParams.set(
      "maxResults",
      "25",
    );

    url.searchParams.set(
      "q",
      q,
    );

    url.searchParams.set(
      "key",
      apiKey,
    );

    try {
      const res =
        await fetch(url);

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
              (i) =>
                i.id?.videoId,
            )
            .map((i) => ({
              id: i.id!.videoId!,
              title:
                i.snippet?.title ??
                "Untitled",
              channel:
                i.snippet
                  ?.channelTitle ??
                "YouTube",
              thumbnail:
                i.snippet
                  ?.thumbnails
                  ?.high?.url ??
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

  const inner =
    await innertubeSearch(q);

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

    const results =
      scrape(await res.text());

    if (!results.length) {
      return {
        results: [],
        error:
          "No results found.",
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
          params:
            "EgIQAQ%3D%3D",
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

      const vr = (
        node as YtRenderer
      ).videoRenderer;

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
                    vr.lengthText
                      .simpleText,
                }
              : {}),
          });
        }
      }

      Object.values(
        node as Record<
          string,
          unknown
        >,
      ).forEach(walk);
    };

    walk(json);

    const seen =
      new Set<string>();

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
 * Local yt-dlp is enabled by default.
 */
function localDownloaderEnabled(): boolean {
  const configured =
    process.env[
      "DOWNLOAD_LOCAL_ENABLED"
    ]
      ?.trim()
      .toLowerCase();

  if (
    configured === "false" ||
    configured === "0"
  ) {
    return false;
  }

  return true;
}

export function providerConfigured(): boolean {
  return (
    Boolean(
      process.env[
        "DOWNLOAD_API_URL"
      ],
    ) ||
    localDownloaderEnabled()
  );
}

/**
 * Download media using the yt-dlp binary
 * bundled by youtube-dl-exec.
 */
async function fetchLocalMedia(
  videoId: string,
  type: "audio" | "video",
): Promise<Response | null> {
  const directory =
    await mkdtemp(
      join(
        tmpdir(),
        "aurora-media-",
      ),
    );

  const output =
    join(
      directory,
      "media.%(ext)s",
    );

  const target =
    `https://www.youtube.com/watch?v=${videoId}`;

  try {
    if (type === "audio") {
      await youtubedl(
        target,
        {
          noPlaylist: true,
          noProgress: true,
          noWarnings: true,
          extractAudio: true,
          audioFormat: "mp3",
          audioQuality: "5",
          output,
        },
        {
          timeout: 240000,
        },
      );
    } else {
      await youtubedl(
        target,
        {
          noPlaylist: true,
          noProgress: true,
          noWarnings: true,
          format:
            "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
          mergeOutputFormat: "mp4",
          output,
        },
        {
          timeout: 240000,
        },
      );
    }

    const fileName =
      (
        await readdir(
          directory,
        )
      ).find((name) =>
        name.startsWith(
          "media.",
        ),
      );

    if (!fileName) {
      console.error(
        "[media] yt-dlp completed but no media file was created.",
      );

      await rm(directory, {
        recursive: true,
        force: true,
      });

      return null;
    }

    const filePath =
      join(
        directory,
        fileName,
      );

    const fileStat =
      await stat(filePath);

    const stream =
      createReadStream(
        filePath,
      );

    const cleanup =
      () =>
        void rm(
          directory,
          {
            recursive: true,
            force: true,
          },
        );

    stream.once(
      "close",
      cleanup,
    );

    stream.once(
      "error",
      cleanup,
    );

    return new Response(
      Readable.toWeb(
        stream,
      ) as unknown as BodyInit,
      {
        headers: {
          "content-type":
            type === "audio"
              ? "audio/mpeg"
              : "video/mp4",

          "content-length":
            String(
              fileStat.size,
            ),

          "cache-control":
            "no-store, no-cache, must-revalidate",
        },
      },
    );
  } catch (error) {
    console.error(
      "[media] Local downloader failed:",
      error,
    );

    await rm(directory, {
      recursive: true,
      force: true,
    });

    return null;
  }
}

/**
 * Download media.
 *
 * Priority:
 * 1. DOWNLOAD_API_URL if configured.
 * 2. Local youtube-dl-exec otherwise.
 */
export async function fetchMedia(
  videoId: string,
  type: "audio" | "video",
): Promise<Response | null> {
  const base =
    process.env[
      "DOWNLOAD_API_URL"
    ];

  /*
   * Keep the existing external-provider
   * fallback if one is configured.
   */
  if (base) {
    const key =
      process.env[
        "DOWNLOAD_API_KEY"
      ] ?? "";

    const url = new URL(
      "/download",
      base.startsWith("http")
        ? base
        : `https://${base}`,
    );

    url.searchParams.set(
      "url",
      videoId,
    );

    url.searchParams.set(
      "type",
      type,
    );

    if (key) {
      url.searchParams.set(
        "api_key",
        key,
      );
    }

    try {
      const res =
        await fetch(url, {
          headers: {
            accept: "*/*",
          },
        });

      if (
        res.ok &&
        res.body
      ) {
        return res;
      }

      console.error(
        `[media] External provider returned ${res.status}`,
      );
    } catch (error) {
      console.error(
        "[media] External provider failed:",
        error,
      );
    }
  }

  /*
   * Vercel/local fallback:
   * youtube-dl-exec supplies yt-dlp.
   */
  if (
    localDownloaderEnabled()
  ) {
    return fetchLocalMedia(
      videoId,
      type,
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
