import { useState } from "react";
import {
  ChevronDown,
  Download,
  FileAudio,
  FileVideo,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import type { Track } from "@/lib/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type DownloadFormat = "audio" | "video";

const FORMATS: Record<
  DownloadFormat,
  {
    label: string;
    description: string;
    extension: string;
    icon: typeof FileAudio;
  }
> = {
  audio: {
    label: "MP3 audio",
    description: "Audio only · smaller file",
    extension: "mp3",
    icon: FileAudio,
  },
  video: {
    label: "MP4 video",
    description: "Video + audio · larger file",
    extension: "mp4",
    icon: FileVideo,
  },
};

function fileNameFromResponse(res: Response, fallback: string): string {
  const disposition = res.headers.get("content-disposition") ?? "";
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition);

  if (encoded?.[1]) {
    try {
      return decodeURIComponent(encoded[1].trim());
    } catch {
      // Fall through to the plain filename.
    }
  }

  const plain = /filename="?([^";]+)"?/i.exec(disposition);

  if (plain?.[1]) {
    return plain[1].trim();
  }

  return fallback;
}

export function DownloadButton({
  track,
  className = "",
  label,
}: {
  track: Track;
  className?: string;
  label?: string;
}) {
  const [busy, setBusy] = useState<DownloadFormat | null>(null);

  async function download(format: DownloadFormat) {
    if (busy) return;

    const { extension, label: formatLabel } = FORMATS[format];
    setBusy(format);

    const toastId = toast.loading(`Preparing ${formatLabel}…`);

    try {
      const res = await fetch(
        `/api/download/${encodeURIComponent(track.id)}?type=${format}`,
        {
          headers: {
            accept: "audio/*,video/*,application/octet-stream",
          },
        },
      );

      const contentType = (res.headers.get("content-type") ?? "").toLowerCase();

      if (!res.ok || contentType.startsWith("application/json") || contentType.startsWith("text/")) {
        let message = "Download failed.";

        if (contentType.includes("json")) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
            details?: string;
          };

          message = body.error ?? body.details ?? message;
        } else {
          const text = await res.text().catch(() => "");

          if (text.trim()) {
            message = text.trim().slice(0, 200);
          }
        }

        toast.error(message, { id: toastId });
        return;
      }

      const blob = await res.blob();

      if (blob.size === 0) {
        toast.error("The downloader returned an empty file.", { id: toastId });
        return;
      }

      const safeTitle =
        track.title
          .replace(/[^\w\s.-]/g, "")
          .trim()
          .slice(0, 80) || "track";

      const fileName = fileNameFromResponse(
        res,
        `${safeTitle}.${extension}`,
      );

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");

      anchor.href = url;
      anchor.download = fileName.endsWith(`.${extension}`)
        ? fileName
        : `${fileName}.${extension}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();

      // Revoke after the browser has started the save.
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);

      toast.success(`${formatLabel} saved to your device`, { id: toastId });
    } catch {
      toast.error("Download failed. Please try again.", { id: toastId });
    } finally {
      setBusy(null);
    }
  }

  const busyLabel = busy ? FORMATS[busy].label : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={busy !== null}
          aria-label={label ?? "Download MP3 or MP4"}
          title={label ?? "Download MP3 or MP4"}
          className={
            className ||
            "inline-flex items-center gap-2 rounded-lg p-2 text-muted-foreground hover:bg-surface-2 hover:text-foreground disabled:opacity-50"
          }
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Download className="size-4" />
          )}

          {label && <span className="text-sm">{label}</span>}

          {busy ? (
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {busyLabel}
            </span>
          ) : (
            label && <ChevronDown className="size-3.5 opacity-60" />
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="flex items-center justify-between gap-2">
          <span>Download</span>
          <span className="text-[10px] font-normal uppercase tracking-widest text-muted-foreground">
            MP3 / MP4
          </span>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        {(Object.keys(FORMATS) as DownloadFormat[]).map((format) => {
          const item = FORMATS[format];
          const Icon = item.icon;

          return (
            <DropdownMenuItem
              key={format}
              disabled={busy !== null}
              onSelect={() => {
                void download(format);
              }}
              className="gap-3 py-2"
            >
              <Icon className="size-4 text-primary" />

              <span className="flex min-w-0 flex-col">
                <span className="text-sm font-medium">{item.label}</span>
                <span className="text-xs text-muted-foreground">
                  {busy === format ? "Preparing…" : item.description}
                </span>
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}