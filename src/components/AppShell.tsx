import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Clock3,
  Heart,
  Link2,
  ListMusic,
  Loader2,
  Pencil,
  Play,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { usePlayer } from "@/lib/player-store";
import { searchYouTube, type SearchResult } from "@/lib/search.functions";
import { parseVideoId, trackFromId } from "@/lib/youtube";
import type { Track } from "@/lib/types";
import { PlayerBar } from "./PlayerBar";
import { QueuePanel } from "./QueuePanel";
import { FullPlayer } from "./FullPlayer";
import { TrackRow } from "./TrackRow";
import { YouTubeHost } from "./YouTubeHost";

type View =
  | { kind: "search" }
  | { kind: "liked" }
  | { kind: "recent" }
  | { kind: "playlist"; id: string };

export function AppShell() {
  const p = usePlayer();
  const runSearch = useServerFn(searchYouTube);
  const [view, setView] = useState<View>({ kind: "search" });
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [queueOpen, setQueueOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async (raw: string) => {
    const value = raw.trim();
    if (!value) return;

    setView({ kind: "search" });

    const videoId = parseVideoId(value);

    if (videoId) {
      const track = trackFromId(videoId, `YouTube • ${videoId}`);
      setResults([{ ...track }]);
      setMessage(null);
      p.playTrack(track);
      return;
    }

    setLoading(true);
    setMessage(null);
    p.pushHistory(value);

    try {
      const res = await runSearch({ data: { q: value } });
      setResults(res.results);
      setMessage(
        res.error ?? (res.results.length ? null : "No results found."),
      );
    } catch {
      setMessage("Search failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Keyboard controls
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing =
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable);

      if (e.key === "/" && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
        return;
      }

      if (typing) return;

      if (e.code === "Space") {
        e.preventDefault();
        p.togglePlay();
      } else if (e.key === "ArrowRight" && e.shiftKey) {
        p.next();
      } else if (e.key === "ArrowLeft" && e.shiftKey) {
        p.previous();
      } else if (e.key === "ArrowRight") {
        p.seek(Math.min(p.duration, p.position + 5));
      } else if (e.key === "ArrowLeft") {
        p.seek(Math.max(0, p.position - 5));
      } else if (e.key === "ArrowUp") {
        p.setVolume(Math.min(100, p.volume + 5));
      } else if (e.key === "ArrowDown") {
        p.setVolume(Math.max(0, p.volume - 5));
      } else if (e.key.toLowerCase() === "m") {
        p.toggleMute();
      } else if (e.key.toLowerCase() === "s") {
        p.toggleShuffle();
      } else if (e.key.toLowerCase() === "r") {
        p.cycleRepeat();
      } else if (e.key.toLowerCase() === "q") {
        setQueueOpen((v) => !v);
      } else if (e.key === "Escape") {
        p.setFullScreen(false);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [p]);

  const likedTracks = useMemo(
    () => p.favorites.map((id) => p.library[id]).filter(Boolean) as Track[],
    [p.favorites, p.library],
  );

  const recentTracks = useMemo(
    () => p.recent.map((id) => p.library[id]).filter(Boolean) as Track[],
    [p.recent, p.library],
  );

  const playlist =
    view.kind === "playlist"
      ? p.playlists.find((x) => x.id === view.id)
      : undefined;

  const playlistTracks = useMemo(
    () =>
      (playlist?.trackIds
        .map((id) => p.library[id])
        .filter(Boolean) as Track[]) ?? [],
    [playlist, p.library],
  );

  const navBtn = (active: boolean) =>
    `flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
      active
        ? "bg-primary/15 text-primary"
        : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"
    }`;

  const list =
    view.kind === "liked"
      ? likedTracks
      : view.kind === "recent"
        ? recentTracks
        : view.kind === "playlist"
          ? playlistTracks
          : (results as Track[]);

  const heading =
    view.kind === "liked"
      ? "Liked songs"
      : view.kind === "recent"
        ? "Recently played"
        : view.kind === "playlist"
          ? (playlist?.name ?? "Playlist")
          : results.length
            ? "Search results"
            : "Start listening";

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <YouTubeHost />
      <FullPlayer />

      <div className="flex flex-1">
        {/* Sidebar */}
        <aside className="hidden w-64 shrink-0 flex-col gap-6 border-r border-border bg-surface/40 p-4 lg:flex">
          <div className="flex items-center gap-2 px-2 pt-2">
            <div className="size-10 shrink-0 overflow-hidden rounded-xl border border-border/60 bg-black shadow-glow">
              <img
                src="/Auroralogo.png"
                alt="Aurora Music"
                className="size-full object-cover"
              />
            </div>
            <span className="font-display text-lg font-bold tracking-tight">
              Aurora
            </span>
          </div>

          <nav className="space-y-1">
            <button
              className={navBtn(view.kind === "search")}
              onClick={() => setView({ kind: "search" })}
            >
              <Search className="size-4" /> Search
            </button>

            <button
              className={navBtn(view.kind === "liked")}
              onClick={() => setView({ kind: "liked" })}
            >
              <Heart className="size-4" /> Liked songs
              <span className="ml-auto text-xs">{likedTracks.length}</span>
            </button>

            <button
              className={navBtn(view.kind === "recent")}
              onClick={() => setView({ kind: "recent" })}
            >
              <Clock3 className="size-4" /> Recently played
            </button>

            <button
              className={navBtn(false)}
              onClick={() => setQueueOpen(true)}
            >
              <ListMusic className="size-4" /> Queue
              <span className="ml-auto text-xs">{p.queue.length}</span>
            </button>
          </nav>

          <div className="min-h-0 flex-1">
            <div className="flex items-center justify-between px-3 pb-2">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Playlists
              </p>

              <button
                aria-label="New playlist"
                onClick={() => {
                  const name = prompt("Playlist name");
                  if (name?.trim()) p.createPlaylist(name.trim());
                }}
                className="rounded-lg p-1 text-muted-foreground hover:bg-surface-2 hover:text-primary"
              >
                <Plus className="size-4" />
              </button>
            </div>

            <div className="space-y-1 overflow-y-auto">
              {p.playlists.length === 0 && (
                <p className="px-3 text-xs text-muted-foreground">
                  No playlists yet.
                </p>
              )}

              {p.playlists.map((pl) => (
                <div key={pl.id} className="group flex items-center">
                  <button
                    className={navBtn(
                      view.kind === "playlist" && view.id === pl.id,
                    )}
                    onClick={() =>
                      setView({ kind: "playlist", id: pl.id })
                    }
                  >
                    <ListMusic className="size-4" />
                    <span className="truncate">{pl.name}</span>
                  </button>

                  <button
                    aria-label="Rename playlist"
                    onClick={() => {
                      const name = prompt("Rename playlist", pl.name);
                      if (name?.trim()) {
                        p.renamePlaylist(pl.id, name.trim());
                      }
                    }}
                    className="rounded p-1.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground"
                  >
                    <Pencil className="size-3.5" />
                  </button>

                  <button
                    aria-label="Delete playlist"
                    onClick={() => {
                      p.deletePlaylist(pl.id);
                      if (
                        view.kind === "playlist" &&
                        view.id === pl.id
                      ) {
                        setView({ kind: "search" });
                      }
                    }}
                    className="rounded p-1.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <p className="rounded-xl bg-surface-2/60 p-3 text-[11px] leading-5 text-muted-foreground">
            Shortcuts: <b>/</b> search · <b>space</b> play · <b>←/→</b> seek ·{" "}
            <b>shift+←/→</b> track · <b>↑/↓</b> volume · <b>m</b> mute ·{" "}
            <b>q</b> queue
          </p>
        </aside>

        {/* Main */}
        <main className="hero-glow min-w-0 flex-1">
          <div className="mx-auto max-w-5xl px-4 py-6 sm:px-8">
            <div className="mb-8 flex items-center gap-3 lg:hidden">
              <div className="size-10 shrink-0 overflow-hidden rounded-xl border border-border/60 bg-black shadow-glow">
                <img
                  src="/Auroralogo.png"
                  alt="Aurora Music"
                  className="size-full object-cover"
                />
              </div>
              <span className="font-display text-lg font-bold">
                Aurora
              </span>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submit(query);
              }}
              className="relative"
            >
              <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />

              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search songs, artists — or paste a YouTube link"
                className="w-full rounded-2xl border border-border bg-surface/80 py-4 pl-11 pr-28 text-sm outline-none ring-ring transition focus:border-primary/40 focus:ring-2"
              />

              <button
                type="submit"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow"
              >
                {loading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  "Search"
                )}
              </button>
            </form>

            {p.history.length > 0 && view.kind === "search" && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {p.history.map((h) => (
                  <button
                    key={h}
                    onClick={() => {
                      setQuery(h);
                      void submit(h);
                    }}
                    className="rounded-full border border-border bg-surface/60 px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    {h}
                  </button>
                ))}

                <button
                  onClick={p.clearHistory}
                  className="rounded-full p-1 text-muted-foreground hover:text-destructive"
                  aria-label="Clear search history"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            )}

            <section className="mt-9">
              <div className="mb-4 flex items-end justify-between gap-4">
                <div>
                  <h1 className="text-2xl font-bold text-gradient">
                    {heading}
                  </h1>

                  <p className="mt-1 text-sm text-muted-foreground">
                    {list.length > 0
                      ? `${list.length} track${list.length === 1 ? "" : "s"}`
                      : "Search YouTube or paste a link to begin."}
                  </p>
                </div>

                {list.length > 0 && (
                  <button
                    onClick={() =>
                      list[0] && p.playTrack(list[0], list)
                    }
                    className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow transition-transform hover:scale-105"
                  >
                    <Play className="size-4 fill-current" /> Play all
                  </button>
                )}
              </div>

              {message && (
                <p className="mb-4 text-sm text-muted-foreground">
                  {message}
                </p>
              )}

              {list.length === 0 &&
                !loading &&
                view.kind === "search" && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <EmptyCard
                      icon={<Search className="size-5" />}
                      title="Search YouTube"
                      body="Find any song or mix and queue it up instantly."
                    />

                    <EmptyCard
                      icon={<Link2 className="size-5" />}
                      title="Paste a link"
                      body="Drop a YouTube URL in the box and it starts playing."
                    />
                  </div>
                )}

              <div className="space-y-1">
                {list.map((track, i) => (
                  <TrackRow
                    key={`${track.id}-${i}`}
                    track={track}
                    index={i}
                    onPlay={() => p.playTrack(track, list)}
                    onRemove={
                      view.kind === "playlist" && playlist
                        ? () =>
                            p.removeFromPlaylist(
                              playlist.id,
                              track.id,
                            )
                        : view.kind === "liked"
                          ? () => p.toggleFavorite(track)
                          : undefined
                    }
                  />
                ))}
              </div>
            </section>
          </div>
        </main>
      </div>

      <QueuePanel
        open={queueOpen}
        onClose={() => setQueueOpen(false)}
      />

      <PlayerBar
        onOpenQueue={() => setQueueOpen(true)}
      />
    </div>
  );
}

function EmptyCard({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface/50 p-5">
      <div className="grid size-10 place-items-center rounded-xl bg-primary/15 text-primary">
        {icon}
      </div>

      <h3 className="mt-4 text-base font-semibold">{title}</h3>

      <p className="mt-1 text-sm text-muted-foreground">
        {body}
      </p>
    </div>
  );
}
