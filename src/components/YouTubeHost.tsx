import { useEffect, useRef } from "react";
import { usePlayer } from "@/lib/player-store";

type YTPlayer = {
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (s: number, allow: boolean) => void;
  setVolume: (v: number) => void;
  loadVideoById: (id: string) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  destroy: () => void;
};

declare global {
  interface Window {
    YT?: {
      Player: new (el: HTMLElement | string, opts: Record<string, unknown>) => YTPlayer;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<void> | null = null;
function loadApi() {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<void>((resolve) => {
    if (window.YT?.Player) return resolve();
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(s);
  });
  return apiPromise;
}

/** Hidden YouTube iframe that provides the actual audio/video playback. */
export function YouTubeHost() {
  const { registerPlayer, onPlayerState, onPlayerTime, current } = usePlayer();
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const pendingRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let ticker: ReturnType<typeof setInterval>;

    loadApi().then(() => {
      if (cancelled || !hostRef.current || !window.YT) return;
      const player = new window.YT.Player(hostRef.current, {
        height: "100%",
        width: "100%",
        playerVars: { controls: 0, disablekb: 1, playsinline: 1, rel: 0, modestbranding: 1 },
        events: {
          onReady: () => {
            playerRef.current = player;
            registerPlayer({
              play: () => player.playVideo(),
              pause: () => player.pauseVideo(),
              seek: (s: number) => player.seekTo(s, true),
              setVolume: (v: number) => player.setVolume(v),
              load: (id: string) => player.loadVideoById(id),
            });
            if (pendingRef.current) {
              player.loadVideoById(pendingRef.current);
              pendingRef.current = null;
            }
          },
          onStateChange: (e: { data: number }) => onPlayerState(e.data),
        },
      });

      ticker = setInterval(() => {
        const p = playerRef.current;
        if (!p) return;
        try {
          onPlayerTime(p.getCurrentTime() ?? 0, p.getDuration() ?? 0);
        } catch {
          /* ignore */
        }
      }, 500);
    });

    return () => {
      cancelled = true;
      clearInterval(ticker);
      registerPlayer(null);
      playerRef.current?.destroy?.();
      playerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (current && !playerRef.current) pendingRef.current = current.id;
  }, [current]);

  return (
    <div className="pointer-events-none fixed bottom-0 left-0 h-px w-px overflow-hidden opacity-0">
      <div ref={hostRef} />
    </div>
  );
}
