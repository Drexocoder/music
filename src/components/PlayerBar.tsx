import {
  ChevronDown,
  ChevronUp,
  Heart,
  ListMusic,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import { usePlayer } from "@/lib/player-store";
import { formatTime } from "@/lib/youtube";
import { Visualizer } from "./Visualizer";

export function PlayerBar({ onOpenQueue }: { onOpenQueue: () => void }) {
  const p = usePlayer();
  const t = p.current;

  const RepeatIcon = p.repeat === "one" ? Repeat1 : Repeat;

  return (
    <div className="glass sticky bottom-0 z-40 border-t border-border">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-2 px-3 py-2 sm:px-5 sm:py-3">
        <div className="flex items-center gap-3">
          <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
            {formatTime(p.position)}
          </span>
          <input
            type="range"
            min={0}
            max={Math.max(1, p.duration)}
            value={Math.min(p.position, p.duration || 1)}
            onChange={(e) => p.seek(Number(e.target.value))}
            aria-label="Seek"
            className="h-1 w-full cursor-pointer appearance-none rounded-full bg-surface-2 accent-primary [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
            style={{
              background: `linear-gradient(to right, var(--primary) ${
                p.duration ? (p.position / p.duration) * 100 : 0
              }%, var(--surface-2) 0%)`,
            }}
          />
          <span className="w-10 shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {formatTime(p.duration)}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {t ? (
              <>
                <img
                  src={t.thumbnail}
                  alt=""
                  className="size-12 shrink-0 rounded-lg object-cover shadow-glow"
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{t.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{t.channel}</p>
                </div>
                <button
                  onClick={() => p.toggleFavorite(t)}
                  aria-label="Like current track"
                  className="hidden rounded-lg p-2 text-muted-foreground hover:text-primary sm:block"
                >
                  <Heart
                    className={`size-4 ${p.isFavorite(t.id) ? "fill-primary text-primary" : ""}`}
                  />
                </button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Nothing playing — search a song above</p>
            )}
          </div>

          <div className="flex items-center gap-1 sm:gap-2">
            <button
              onClick={p.toggleShuffle}
              aria-label="Shuffle"
              className={`hidden rounded-lg p-2 sm:block ${p.shuffle ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Shuffle className="size-4" />
            </button>
            <button
              onClick={p.previous}
              aria-label="Previous"
              className="rounded-lg p-2 text-foreground/80 hover:text-foreground"
            >
              <SkipBack className="size-5 fill-current" />
            </button>
            <button
              onClick={p.togglePlay}
              aria-label={p.isPlaying ? "Pause" : "Play"}
              className="grid size-11 place-items-center rounded-full bg-primary text-primary-foreground shadow-glow transition-transform hover:scale-105"
            >
              {p.isPlaying ? (
                <Pause className="size-5 fill-current" />
              ) : (
                <Play className="size-5 translate-x-[1px] fill-current" />
              )}
            </button>
            <button
              onClick={p.next}
              aria-label="Next"
              className="rounded-lg p-2 text-foreground/80 hover:text-foreground"
            >
              <SkipForward className="size-5 fill-current" />
            </button>
            <button
              onClick={p.cycleRepeat}
              aria-label="Repeat"
              className={`hidden rounded-lg p-2 sm:block ${p.repeat !== "off" ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
            >
              <RepeatIcon className="size-4" />
            </button>
          </div>

          <div className="flex flex-1 items-center justify-end gap-2">
            <div className="hidden lg:block">
              <Visualizer active={p.isPlaying} compact />
            </div>
            <button
              onClick={p.toggleMute}
              aria-label="Mute"
              className="rounded-lg p-2 text-muted-foreground hover:text-foreground"
            >
              {p.muted || p.volume === 0 ? (
                <VolumeX className="size-4" />
              ) : p.volume < 50 ? (
                <Volume1 className="size-4" />
              ) : (
                <Volume2 className="size-4" />
              )}
            </button>
            <input
              type="range"
              min={0}
              max={100}
              value={p.muted ? 0 : p.volume}
              onChange={(e) => p.setVolume(Number(e.target.value))}
              aria-label="Volume"
              className="hidden h-1 w-24 cursor-pointer appearance-none rounded-full bg-surface-2 accent-primary [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary sm:block"
            />
            <button
              onClick={onOpenQueue}
              aria-label="Queue"
              className="rounded-lg p-2 text-muted-foreground hover:text-foreground"
            >
              <ListMusic className="size-4" />
            </button>
            <button
              onClick={() => p.setFullScreen(!p.fullScreen)}
              aria-label="Toggle full player"
              className="rounded-lg p-2 text-muted-foreground hover:text-foreground"
            >
              {p.fullScreen ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
