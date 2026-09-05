import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { Track } from "@/lib/types";

export function DownloadButton({
  track,
  type = "audio",
  className = "",
  label,
}: {
  track: Track;
  type?: "audio" | "video";
  className?: string;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    const id = toast.loading(`Preparing ${type === "video" ? "video" : "audio"}…`);
    try {
      const res = await fetch(`/api/download/${track.id}?type=${type}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? "Download failed.", { id });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${track.title.replace(/[^\w\s.-]/g, "").trim() || "track"}.${
        type === "video" ? "mp4" : "mp3"
      }`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Saved to your device", { id });
    } catch {
      toast.error("Download failed.", { id });
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={download}
      disabled={busy}
      aria-label={label ?? `Download ${type}`}
      title={label ?? `Download ${type}`}
      className={
        className ||
        "rounded-lg p-2 text-muted-foreground hover:bg-surface-2 hover:text-foreground disabled:opacity-50"
      }
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
      {label && <span className="ml-2 text-sm">{label}</span>}
    </button>
  );
}
