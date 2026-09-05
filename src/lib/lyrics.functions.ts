import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const schema = z.object({ title: z.string().min(1).max(200), channel: z.string().max(120) });

function guess(title: string, channel: string) {
  const cleaned = title
    .replace(/\((?:[^)]*(?:official|video|audio|lyric|hd|4k|remaster)[^)]*)\)/gi, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\b(official\s*(music\s*)?video|official audio|lyrics?|hq|hd)\b/gi, "")
    .trim();
  const parts = cleaned.split(/\s+[-–—]\s+/);
  if (parts.length >= 2) return { artist: parts[0]!.trim(), song: parts.slice(1).join(" - ").trim() };
  return { artist: channel.replace(/\s*-\s*Topic$/i, "").trim(), song: cleaned };
}

export const fetchLyrics = createServerFn({ method: "POST" })
  .inputValidator((data: { title: string; channel: string }) => schema.parse(data))
  .handler(async ({ data }): Promise<{ lyrics?: string; error?: string }> => {
    const { artist, song } = guess(data.title, data.channel);
    if (!artist || !song) return { error: "Couldn't work out the artist and song name." };
    try {
      const res = await fetch(
        `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(song)}`,
      );
      if (!res.ok) return { error: "No lyrics found for this track." };
      const json = (await res.json()) as { lyrics?: string };
      const lyrics = json.lyrics?.trim();
      if (!lyrics) return { error: "No lyrics found for this track." };
      return { lyrics };
    } catch {
      return { error: "Lyrics service is unavailable right now." };
    }
  });
