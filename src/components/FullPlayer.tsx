import { useEffect, useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { usePlayer } from "@/lib/player-store";
import { fetchLyrics } from "@/lib/lyrics.functions";
import { Visualizer } from "./Visualizer";

export function FullPlayer() {
  const p = usePlayer();
  const getLyrics = useServerFn(fetchLyrics);
  const [lyrics, setLyrics] = useState<string | null>(null);
  const [lyricsError, setLyricsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const t = p.current;

  useEffect(() => {
    if (!p.fullScreen || !t) return;
    let cancelled = false;
    setLoading(true);
    setLyrics(null);
    setLyricsError(null);
    getLyrics({ data: { title: t.title, channel: t.channel } })
      .then((r) => {
        if (cancelled) return;
        if (r.lyrics) setLyrics(r.lyrics);
        else setLyricsError(r.error ?? "No lyrics found.");
      })
      .catch(() => !cancelled && setLyricsError("No lyrics found."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [p.fullScreen, t?.id, getLyrics, t]);

  if (!p.fullScreen) return null;

  return (
    <div className="hero-glow fixed inset-0 z-40 overflow-y-auto bg-background pb-40">
      <div className="mx-auto max-w-5xl px-5 py-6">
        <button
          onClick={() => p.setFullScreen(false)}
          className="mb-8 inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronDown className="size-4" /> Back to library
        </button>

        {t ? (
          <div className="grid gap-10 md:grid-cols-[minmax(0,340px)_1fr]">
            <div>
              <img
                src={t.thumbnail}
                alt={t.title}
                className="aspect-square w-full rounded-3xl object-cover shadow-panel"
              />
              <h1 className="mt-6 text-2xl font-bold leading-tight">{t.title}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{t.channel}</p>
              <div className="mt-6">
                <Visualizer active={p.isPlaying} />
              </div>
            </div>

            <div className="rounded-3xl border border-border bg-surface/60 p-6">
              <h2 className="text-sm font-semibold uppercase tracking-widest text-primary">
                Lyrics
              </h2>
              {loading && (
                <p className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Looking for lyrics…
                </p>
              )}
              {!loading && lyrics && (
                <pre className="mt-4 whitespace-pre-wrap font-sans text-sm leading-7 text-foreground/85">
                  {lyrics}
                </pre>
              )}
              {!loading && !lyrics && (
                <p className="mt-4 text-sm text-muted-foreground">
                  {lyricsError ?? "No lyrics available."}
                </p>
              )}
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground">Nothing is playing yet.</p>
        )}
      </div>
    </div>
  );
}
