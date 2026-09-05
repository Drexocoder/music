import { ArrowDown, ArrowUp, X } from "lucide-react";
import { usePlayer } from "@/lib/player-store";

export function QueuePanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const p = usePlayer();
  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-background/60 backdrop-blur-sm lg:hidden" onClick={onClose} />
      <aside className="fixed right-0 top-0 z-50 flex h-full w-full max-w-sm flex-col border-l border-border bg-surface shadow-panel">
        <header className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">Up next</h2>
            <p className="text-xs text-muted-foreground">{p.queue.length} tracks in queue</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={p.clearQueue}
              className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:bg-surface-2 hover:text-foreground"
            >
              Clear
            </button>
            <button onClick={onClose} aria-label="Close queue" className="rounded-lg p-2 hover:bg-surface-2">
              <X className="size-4" />
            </button>
          </div>
        </header>

        <div className="flex-1 space-y-1 overflow-y-auto p-3">
          {p.queue.length === 0 && (
            <p className="px-2 py-8 text-center text-sm text-muted-foreground">
              Your queue is empty.
            </p>
          )}
          {p.queue.map((id, i) => {
            const track = p.library[id];
            if (!track) return null;
            const active = i === p.index;
            return (
              <div
                key={`${id}-${i}`}
                className={`group flex items-center gap-3 rounded-xl px-2 py-2 ${
                  active ? "bg-primary/10" : "hover:bg-surface-2/70"
                }`}
              >
                <img src={track.thumbnail} alt="" className="size-10 rounded-lg object-cover" />
                <button onClick={() => p.jumpTo(i)} className="min-w-0 flex-1 text-left">
                  <p className={`truncate text-sm ${active ? "text-primary" : ""}`}>{track.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{track.channel}</p>
                </button>
                <div className="flex opacity-0 group-hover:opacity-100">
                  <button
                    onClick={() => p.moveInQueue(i, Math.max(0, i - 1))}
                    aria-label="Move up"
                    className="rounded p-1.5 text-muted-foreground hover:text-foreground"
                  >
                    <ArrowUp className="size-3.5" />
                  </button>
                  <button
                    onClick={() => p.moveInQueue(i, Math.min(p.queue.length - 1, i + 1))}
                    aria-label="Move down"
                    className="rounded p-1.5 text-muted-foreground hover:text-foreground"
                  >
                    <ArrowDown className="size-3.5" />
                  </button>
                  <button
                    onClick={() => p.removeFromQueue(i)}
                    aria-label="Remove from queue"
                    className="rounded p-1.5 text-muted-foreground hover:text-destructive"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </aside>
    </>
  );
}
