export type Track = {
  id: string; // YouTube video id
  title: string;
  channel: string;
  thumbnail: string;
  duration?: string;
};

export type Playlist = {
  id: string;
  name: string;
  trackIds: string[];
  createdAt: number;
};

export type RepeatMode = "off" | "all" | "one";
