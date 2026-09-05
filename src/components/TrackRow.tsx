import { Heart, ListPlus, Play, Plus, Trash2 } from "lucide-react";
import { usePlayer } from "@/lib/player-store";
import type { Track } from "@/lib/types";
import { Visualizer } from "./Visualizer";
import { DownloadButton } from "./DownloadButton";


export function TrackRow({
  track,
  onPlay,
  onRemove,
  index,
}: {
  track: Track;
  onPlay: () => void;
  onRemove?: (() => void) | undefined;
  index?: number | undefined;
}) {

  const { current, isPlaying, addToQueue, toggleFavorite, isFavorite, playlists, addToPlaylist } =
    usePlayer();
  const active = current?.id === track.id;

  return (
    <div
      onDoubleClick={onPlay}
      className={`group flex items-center gap-3 rounded-xl px-3 py-2 transition-colors ${
        active ? "bg-primary/10" : "hover:bg-surface-2/70"
      }`}
    >
      <div className="w-6 shrink-0 text-center text-xs text-muted-foreground">
        {active && isPlaying ? (
          <Visualizer active compact />
        ) : (
          <span className="group-hover:hidden">{index !== undefined ? index + 1 : ""}</span>
        )}
        {!(active && isPlaying) && (
          <button onClick={onPlay} className="hidden group-hover:block" aria-label="Play">
            <Play className="size-4 fill-current" />
          </button>
        )}
      </div>

      <img
        src={track.thumbnail}
        alt=""
        loading="lazy"
        className="size-11 shrink-0 rounded-lg object-cover"
      />

      <button onClick={onPlay} className="min-w-0 flex-1 text-left">
        <p
          className={`truncate text-sm font-medium ${active ? "text-primary" : "text-foreground"}`}
        >
          {track.title}
        </p>
        <p className="truncate text-xs text-muted-foreground">{track.channel}</p>
      </button>

      {track.duration && (
        <span className="hidden text-xs tabular-nums text-muted-foreground sm:block">
          {track.duration}
        </span>
      )}

      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <button
          onClick={() => toggleFavorite(track)}
          aria-label="Like"
          className="rounded-lg p-2 text-muted-foreground hover:bg-surface-2 hover:text-primary"
        >
          <Heart className={`size-4 ${isFavorite(track.id) ? "fill-primary text-primary" : ""}`} />
        </button>
        <button
          onClick={() => addToQueue(track)}
          aria-label="Add to queue"
          className="rounded-lg p-2 text-muted-foreground hover:bg-surface-2 hover:text-foreground"
        >
          <ListPlus className="size-4" />
        </button>
        <DownloadButton track={track} />

        {playlists.length > 0 && (
          <div className="relative">
            <details className="group/menu">
              <summary className="list-none rounded-lg p-2 text-muted-foreground hover:bg-surface-2 hover:text-foreground">
                <Plus className="size-4" />
              </summary>
              <div className="absolute right-0 z-30 mt-1 w-52 rounded-xl border border-border bg-popover p-1 shadow-panel">
                {playlists.map((p) => (
                  <button
                    key={p.id}
                    onClick={(e) => {
                      addToPlaylist(p.id, track);
                      (e.currentTarget.closest("details") as HTMLDetailsElement).open = false;
                    }}
                    className="block w-full truncate rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-2"
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </details>
          </div>
        )}
        {onRemove && (
          <button
            onClick={onRemove}
            aria-label="Remove"
            className="rounded-lg p-2 text-muted-foreground hover:bg-surface-2 hover:text-destructive"
          >
            <Trash2 className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}
