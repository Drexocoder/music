import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/download/$id")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const {
          extractVideoId,
          fetchMedia,
          ytMeta,
          safeFileName,
          providerConfigured,
        } = await import("@/lib/media.server");

        if (!providerConfigured()) {
          return Response.json(
            {
              error:
                "Downloads are not set up yet. Point DOWNLOAD_API_URL at your yt-dlp download service.",
            },
            { status: 503 },
          );
        }


        const videoId = extractVideoId(params.id);

        if (!videoId) {
          return Response.json(
            { error: "Invalid YouTube video id" },
            { status: 400 },
          );
        }

        const requestUrl = new URL(request.url);

        const type =
          requestUrl.searchParams.get("type") === "video"
            ? "video"
            : "audio";

        try {
          const upstream = await fetchMedia(videoId, type);

          if (!upstream || !upstream.ok || !upstream.body) {
            let details = "Download failed.";

            try {
              if (!upstream) {
                throw new Error("Downloader unavailable");
              }
              const json = (await upstream.json()) as {
                error?: string;
                details?: string;
              };

              details =
                json.details ??
                json.error ??
                details;
            } catch {
              // Ignore invalid error response.
            }

            console.error(
              "[media] Python downloader failed:",
              upstream?.status ?? 502,
              details,
            );

            return Response.json(
              {
                error: details,
              },
              {
                status:
                  upstream && upstream.status >= 400
                    ? upstream.status
                    : 502,
              },
            );
          }

          const meta = await ytMeta(videoId);

          const ext =
            type === "video"
              ? "mp4"
              : "mp3";

          const filename = safeFileName(
            meta?.title ?? videoId,
            ext,
          );

          const headers = new Headers();

          headers.set(
            "content-type",
            type === "video"
              ? "video/mp4"
              : "audio/mpeg",
          );

          headers.set(
            "content-disposition",
            `attachment; filename="${filename}"`,
          );

          const contentLength =
            upstream.headers.get(
              "content-length",
            );

          if (contentLength) {
            headers.set(
              "content-length",
              contentLength,
            );
          }

          headers.set(
            "cache-control",
            "no-store, no-cache, must-revalidate",
          );

          return new Response(
            upstream.body,
            {
              status: 200,
              headers,
            },
          );
        } catch (error) {
          console.error(
            "[media] Python downloader request failed:",
            error,
          );

          return Response.json(
            {
              error:
                "Unable to start the download. Please try again.",
            },
            {
              status: 502,
            },
          );
        }
      },
    },
  },
});
