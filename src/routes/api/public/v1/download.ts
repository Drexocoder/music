import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/v1/download")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const key = url.searchParams.get("api_key") ?? url.searchParams.get("key") ?? "";
        const target = url.searchParams.get("url") ?? url.searchParams.get("id") ?? "";
        const type = url.searchParams.get("type") === "video" ? "video" : "audio";

        if (!key || !target) {
          return Response.json(
            { ok: false, error: "api_key and url are required" },
            { status: 400 },
          );
        }

        const { extractVideoId, fetchMedia, ytMeta, safeFileName, providerConfigured } =
          await import("@/lib/media.server");
        const videoId = extractVideoId(target);
        if (!videoId) {
          return Response.json({ ok: false, error: "Invalid YouTube url or id" }, { status: 400 });
        }

        const { consumeQuota, quotaMessage } = await import("@/lib/api-keys.server");
        const quota = await consumeQuota(key);
        if (!quota.ok) {
          return Response.json(
            { ok: false, error: quotaMessage(quota.reason) },
            { status: quota.reason === "invalid_key" ? 401 : 429 },
          );
        }

        if (!providerConfigured()) {
          return Response.json(
            { ok: false, error: "Media provider is not configured on this server." },
            { status: 503 },
          );
        }

        const upstream = await fetchMedia(videoId, type);
        if (!upstream || !upstream.body) {
          return Response.json({ ok: false, error: "Download failed." }, { status: 502 });
        }

        const meta = await ytMeta(videoId);
        const ext = type === "video" ? "mp4" : "mp3";
        const headers = new Headers();
        headers.set("content-type", type === "video" ? "video/mp4" : "audio/mpeg");
        headers.set(
          "content-disposition",
          `attachment; filename="${safeFileName(meta?.title ?? videoId, ext)}"`,
        );
        const len = upstream.headers.get("content-length");
        if (len) headers.set("content-length", len);
        headers.set("cache-control", "no-store");
        headers.set("access-control-allow-origin", "*");
        headers.set("x-quota-used-today", String(quota.used_today));
        headers.set("x-quota-used-month", String(quota.used_month));

        return new Response(upstream.body, { headers });
      },
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "GET, OPTIONS",
            "access-control-allow-headers": "*",
          },
        }),
    },
  },
});
