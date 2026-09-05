import type { Track } from "./types";

/** Extract a YouTube video id from any common URL shape (or a raw id). */
export function parseVideoId(input: string): string | null {
  const value = input.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(value)) return value;
  try {
    const url = new URL(value.startsWith("http") ? value : `https://${value}`);
    const host = url.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = url.pathname.slice(1, 12);
      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }
    if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
      const v = url.searchParams.get("v");
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
      const m = url.pathname.match(/\/(embed|shorts|live|v)\/([a-zA-Z0-9_-]{11})/);
      if (m) return m[2] ?? null;
    }
  } catch {
    return null;
  }
  return null;
}

export function thumbFor(id: string) {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

export function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const s = Math.floor(seconds % 60);
  const m = Math.floor(seconds / 60) % 60;
  const h = Math.floor(seconds / 3600);
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

export function trackFromId(id: string, title?: string, channel?: string): Track {
  return {
    id,
    title: title ?? "YouTube track",
    channel: channel ?? "YouTube",
    thumbnail: thumbFor(id),
  };
}
