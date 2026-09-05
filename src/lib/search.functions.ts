import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type SearchResult = {
  id: string;
  title: string;
  channel: string;
  thumbnail: string;
  duration?: string;
};

const inputSchema = z.object({ q: z.string().min(1).max(120) });

type YtRenderer = {
  videoRenderer?: {
    videoId?: string;
    title?: { runs?: Array<{ text?: string }> };
    ownerText?: { runs?: Array<{ text?: string }> };
    lengthText?: { simpleText?: string };
  };
};

function scrape(html: string): SearchResult[] {
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

  const out: SearchResult[] = [];
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

export const searchYouTube = createServerFn({ method: "POST" })
  .inputValidator((data: { q: string }) => inputSchema.parse(data))
  .handler(async ({ data }): Promise<{ results: SearchResult[]; error?: string }> => {
    const apiKey = process.env["YOUTUBE_API_KEY"];

    if (apiKey) {
      const url = new URL("https://www.googleapis.com/youtube/v3/search");
      url.searchParams.set("part", "snippet");
      url.searchParams.set("type", "video");
      url.searchParams.set("videoEmbeddable", "true");
      url.searchParams.set("maxResults", "25");
      url.searchParams.set("q", data.q);
      url.searchParams.set("key", apiKey);
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
    }

    try {
      const res = await fetch(
        `https://www.youtube.com/results?search_query=${encodeURIComponent(data.q)}&sp=EgIQAQ%253D%253D`,
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
  });
