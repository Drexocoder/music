import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { PlayerProvider } from "@/lib/player-store";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Aurora — YouTube Music Player with Playlists & Queue" },
      {
        name: "description",
        content:
          "Aurora is a dark, premium music player that streams from YouTube: search, paste links, build playlists, queue tracks, and view lyrics.",
      },
      { property: "og:title", content: "Aurora — YouTube Music Player" },
      {
        property: "og:description",
        content:
          "Search YouTube, build playlists, queue tracks and play them in a fast, dark music player.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <PlayerProvider>
      <AppShell />
    </PlayerProvider>
  );
}
