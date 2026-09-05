import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Playlist, RepeatMode, Track } from "./types";

const STORAGE_KEY = "aurora-player-state-v1";

type PersistShape = {
  library: Record<string, Track>;
  queue: string[];
  index: number;
  favorites: string[];
  playlists: Playlist[];
  recent: string[];
  history: string[];
  volume: number;
  shuffle: boolean;
  repeat: RepeatMode;
};

const initial: PersistShape = {
  library: {},
  queue: [],
  index: -1,
  favorites: [],
  playlists: [],
  recent: [],
  history: [],
  volume: 80,
  shuffle: false,
  repeat: "off",
};

type PlayerContextValue = {
  ready: boolean;
  library: Record<string, Track>;
  queue: string[];
  index: number;
  current: Track | null;
  isPlaying: boolean;
  position: number;
  duration: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  favorites: string[];
  playlists: Playlist[];
  recent: string[];
  history: string[];
  fullScreen: boolean;
  setFullScreen: (v: boolean) => void;
  playTrack: (track: Track, queueTracks?: Track[]) => void;
  addToQueue: (track: Track, playNext?: boolean) => void;
  removeFromQueue: (position: number) => void;
  moveInQueue: (from: number, to: number) => void;
  clearQueue: () => void;
  jumpTo: (position: number) => void;
  togglePlay: () => void;
  next: () => void;
  previous: () => void;
  seek: (seconds: number) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  toggleFavorite: (track: Track) => void;
  isFavorite: (id: string) => boolean;
  createPlaylist: (name: string) => string;
  renamePlaylist: (id: string, name: string) => void;
  deletePlaylist: (id: string) => void;
  addToPlaylist: (playlistId: string, track: Track) => void;
  removeFromPlaylist: (playlistId: string, trackId: string) => void;
  pushHistory: (q: string) => void;
  clearHistory: () => void;
  registerPlayer: (api: PlayerApi | null) => void;
  onPlayerState: (state: number) => void;
  onPlayerTime: (position: number, duration: number) => void;
};

export type PlayerApi = {
  play: () => void;
  pause: () => void;
  seek: (s: number) => void;
  setVolume: (v: number) => void;
  load: (id: string) => void;
};

const PlayerContext = createContext<PlayerContextValue | null>(null);

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PersistShape>(initial);
  const [ready, setReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);
  const apiRef = useRef<PlayerApi | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setState({ ...initial, ...(JSON.parse(raw) as PersistShape) });
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }, [state, ready]);

  const current = state.index >= 0 ? (state.library[state.queue[state.index] ?? ""] ?? null) : null;

  const loadIndex = useCallback((next: number, s: PersistShape) => {
    const id = s.queue[next];
    if (!id) return;
    apiRef.current?.load(id);
    setPosition(0);
    setIsPlaying(true);
  }, []);

  const playTrack = useCallback(
    (track: Track, queueTracks?: Track[]) => {
      setState((s) => {
        const list = queueTracks?.length ? queueTracks : [track];
        const library = { ...s.library };
        list.forEach((t) => (library[t.id] = t));
        library[track.id] = track;
        const queue = list.map((t) => t.id);
        const index = Math.max(0, queue.indexOf(track.id));
        const recent = [track.id, ...s.recent.filter((r) => r !== track.id)].slice(0, 50);
        const nextState = { ...s, library, queue, index, recent };
        queueMicrotask(() => loadIndex(index, nextState));
        return nextState;
      });
    },
    [loadIndex],
  );

  const addToQueue = useCallback(
    (track: Track, playNext = false) => {
      setState((s) => {
        const library = { ...s.library, [track.id]: track };
        const queue = [...s.queue];
        const at = playNext && s.index >= 0 ? s.index + 1 : queue.length;
        queue.splice(at, 0, track.id);
        const empty = s.index < 0;
        const index = empty ? 0 : s.index;
        const nextState = { ...s, library, queue, index };
        if (empty) queueMicrotask(() => loadIndex(0, nextState));
        return nextState;
      });
    },
    [loadIndex],
  );

  const goTo = useCallback(
    (target: number) => {
      setState((s) => {
        if (target < 0 || target >= s.queue.length) return s;
        const id = s.queue[target]!;
        const recent = [id, ...s.recent.filter((r) => r !== id)].slice(0, 50);
        const nextState = { ...s, index: target, recent };
        queueMicrotask(() => loadIndex(target, nextState));
        return nextState;
      });
    },
    [loadIndex],
  );

  const next = useCallback(() => {
    setState((s) => {
      if (!s.queue.length) return s;
      let target: number;
      if (s.shuffle && s.queue.length > 1) {
        do {
          target = Math.floor(Math.random() * s.queue.length);
        } while (target === s.index);
      } else if (s.index + 1 < s.queue.length) {
        target = s.index + 1;
      } else if (s.repeat === "all") {
        target = 0;
      } else {
        return s;
      }
      const id = s.queue[target]!;
      const recent = [id, ...s.recent.filter((r) => r !== id)].slice(0, 50);
      const nextState = { ...s, index: target, recent };
      queueMicrotask(() => loadIndex(target, nextState));
      return nextState;
    });
  }, [loadIndex]);

  const previous = useCallback(() => {
    if (position > 4) {
      apiRef.current?.seek(0);
      return;
    }
    setState((s) => {
      const target = s.index - 1 >= 0 ? s.index - 1 : s.repeat === "all" ? s.queue.length - 1 : -1;
      if (target < 0) return s;
      const nextState = { ...s, index: target };
      queueMicrotask(() => loadIndex(target, nextState));
      return nextState;
    });
  }, [loadIndex, position]);

  const togglePlay = useCallback(() => {
    if (!apiRef.current) return;
    if (isPlaying) apiRef.current.pause();
    else apiRef.current.play();
  }, [isPlaying]);

  const value = useMemo<PlayerContextValue>(
    () => ({
      ready,
      library: state.library,
      queue: state.queue,
      index: state.index,
      current,
      isPlaying,
      position,
      duration,
      volume: state.volume,
      muted,
      shuffle: state.shuffle,
      repeat: state.repeat,
      favorites: state.favorites,
      playlists: state.playlists,
      recent: state.recent,
      history: state.history,
      fullScreen,
      setFullScreen,
      playTrack,
      addToQueue,
      removeFromQueue: (pos) =>
        setState((s) => {
          const queue = s.queue.filter((_, i) => i !== pos);
          let index = s.index;
          if (pos < s.index) index -= 1;
          else if (pos === s.index) index = Math.min(index, queue.length - 1);
          return { ...s, queue, index };
        }),
      moveInQueue: (from, to) =>
        setState((s) => {
          const queue = [...s.queue];
          const [item] = queue.splice(from, 1);
          if (item === undefined) return s;
          queue.splice(to, 0, item);
          const currentId = s.queue[s.index];
          return { ...s, queue, index: currentId ? queue.indexOf(currentId) : s.index };
        }),
      clearQueue: () => setState((s) => ({ ...s, queue: [], index: -1 })),
      jumpTo: goTo,
      togglePlay,
      next,
      previous,
      seek: (seconds) => {
        apiRef.current?.seek(seconds);
        setPosition(seconds);
      },
      setVolume: (v) => {
        apiRef.current?.setVolume(v);
        setMuted(v === 0);
        setState((s) => ({ ...s, volume: v }));
      },
      toggleMute: () => {
        setMuted((m) => {
          apiRef.current?.setVolume(m ? state.volume : 0);
          return !m;
        });
      },
      toggleShuffle: () => setState((s) => ({ ...s, shuffle: !s.shuffle })),
      cycleRepeat: () =>
        setState((s) => ({
          ...s,
          repeat: s.repeat === "off" ? "all" : s.repeat === "all" ? "one" : "off",
        })),
      toggleFavorite: (track) =>
        setState((s) => ({
          ...s,
          library: { ...s.library, [track.id]: track },
          favorites: s.favorites.includes(track.id)
            ? s.favorites.filter((f) => f !== track.id)
            : [track.id, ...s.favorites],
        })),
      isFavorite: (id) => state.favorites.includes(id),
      createPlaylist: (name) => {
        const id = uid();
        setState((s) => ({
          ...s,
          playlists: [...s.playlists, { id, name, trackIds: [], createdAt: Date.now() }],
        }));
        return id;
      },
      renamePlaylist: (id, name) =>
        setState((s) => ({
          ...s,
          playlists: s.playlists.map((p) => (p.id === id ? { ...p, name } : p)),
        })),
      deletePlaylist: (id) =>
        setState((s) => ({ ...s, playlists: s.playlists.filter((p) => p.id !== id) })),
      addToPlaylist: (playlistId, track) =>
        setState((s) => ({
          ...s,
          library: { ...s.library, [track.id]: track },
          playlists: s.playlists.map((p) =>
            p.id === playlistId && !p.trackIds.includes(track.id)
              ? { ...p, trackIds: [...p.trackIds, track.id] }
              : p,
          ),
        })),
      removeFromPlaylist: (playlistId, trackId) =>
        setState((s) => ({
          ...s,
          playlists: s.playlists.map((p) =>
            p.id === playlistId ? { ...p, trackIds: p.trackIds.filter((t) => t !== trackId) } : p,
          ),
        })),
      pushHistory: (q) =>
        setState((s) => ({
          ...s,
          history: [q, ...s.history.filter((h) => h.toLowerCase() !== q.toLowerCase())].slice(0, 12),
        })),
      clearHistory: () => setState((s) => ({ ...s, history: [] })),
      registerPlayer: (api) => {
        apiRef.current = api;
        if (api) api.setVolume(muted ? 0 : state.volume);
      },
      onPlayerState: (playerState) => {
        if (playerState === 1) setIsPlaying(true);
        if (playerState === 2) setIsPlaying(false);
        if (playerState === 0) {
          if (state.repeat === "one") {
            apiRef.current?.seek(0);
            apiRef.current?.play();
          } else {
            next();
          }
        }
      },
      onPlayerTime: (pos, dur) => {
        setPosition(pos);
        setDuration(dur);
      },
    }),
    [
      ready,
      state,
      current,
      isPlaying,
      position,
      duration,
      muted,
      fullScreen,
      playTrack,
      addToQueue,
      goTo,
      togglePlay,
      next,
      previous,
    ],
  );

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used inside PlayerProvider");
  return ctx;
}
