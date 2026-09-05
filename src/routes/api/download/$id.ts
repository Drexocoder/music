import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/download/$id")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const { extractVideoId, fetchMedia, ytMeta, safeFileName, providerConfigured } =
          await import("@/lib/media.server");

        const videoId = extractVideoId(params.id);
        if (!videoId) return Response.json({ error: "Invalid video id" }, { status: 400 });

        const url = new URL(request.url);
        const type = url.searchParams.get("type") === "video" ? "video" : "audio";

        if (!providerConfigured()) {
          return Response.json(
            { error: "Downloads are not configured yet on this server." },
            { status: 503 },
          );
        }

        const upstream = await fetchMedia(videoId, type);
        if (!upstream || !upstream.body) {
          return Response.json({ error: "Download failed. Try again later." }, { status: 502 });
        }

        const meta = await ytMeta(videoId);
        const ext = type === "video" ? "mp4" : "mp3";
        const filename = safeFileName(meta?.title ?? videoId, ext);

        const headers = new Headers();
        headers.set("content-type", type === "video" ? "video/mp4" : "audio/mpeg");
        headers.set("content-disposition", `attachment; filename="${filename}"`);
        const len = upstream.headers.get("content-length");
        if (len) headers.set("content-length", len);
        headers.set("cache-control", "no-store");

        return new Response(upstream.body, { headers });
      },
    },
  },
});
