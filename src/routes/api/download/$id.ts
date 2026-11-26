import { createFileRoute } from "@tanstack/react-router";

const FORMAT_EXTENSION = {
  audio: "mp3",
  video: "mp4",
} as const;

const FORMAT_CONTENT_TYPE = {
  audio: "audio/mpeg",
  video: "video/mp4",
} as const;

export const Route = createFileRoute("/api/download/$id")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const {
          extractVideoId,
          fetchMedia,
          ytMeta,
          safeFileName,
        } = await import("@/lib/media.server");

        const videoId = extractVideoId(params.id);

        if (!videoId) {
          return Response.json(
            { error: "Invalid YouTube video id" },
            { status: 400 },
          );
        }

        const requestUrl = new URL(request.url);

        const requestedFormat =
          requestUrl.searchParams.get("type") ??
          requestUrl.searchParams.get("format");

        const type =
          requestedFormat === "video" ||
          requestedFormat === "mp4"
            ? "video"
            : "audio";

        // If this request already came from the origin proxy, the
        // downloader service is not reachable. Return immediately instead of
        // calling ourselves again in a loop.
        if (request.headers.get("x-aurora-proxy") === "1") {
          return Response.json(
            {
              error:
                "The download service is not reachable. Deploy the downloader container (vercel.json) or set DOWNLOAD_API_URL.",
            },
            { status: 502 },
          );
        }

        try {
          const upstream = await fetchMedia(videoId, type, {
            downloaderOrigin: requestUrl.origin,
            allowOriginProxy: true,
          });

          if (!upstream || !upstream.ok || !upstream.body) {
            let details = "Download failed.";

            try {
              if (!upstream) {
                throw new Error("Downloader unavailable");
              }

              const body = await upstream.text();

              try {
                const json = JSON.parse(body) as {
                  error?: string;
                  details?: string;
                };

                details =
                  json.details ??
                  json.error ??
                  details;
              } catch {
                details = body.slice(0, 500) || details;
              }
            } catch {
              // Ignore invalid error response.
            }

            console.error(
              "[media] Downloader failed:",
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

          const ext = FORMAT_EXTENSION[type];
          const filename = safeFileName(
            meta?.title ?? videoId,
            ext,
          );

          const upstreamContentType = (
            upstream.headers.get("content-type") ?? ""
          )
            .trim()
            .toLowerCase();

          const headers = new Headers();

          headers.set(
            "content-type",
            upstreamContentType.startsWith("audio/") ||
              upstreamContentType.startsWith("video/")
              ? upstreamContentType
              : FORMAT_CONTENT_TYPE[type],
          );

          headers.set(
            "content-disposition",
            `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(
              filename,
            )}`,
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

          headers.set("x-aurora-format", ext);

          return new Response(
            upstream.body,
            {
              status: 200,
              headers,
            },
          );
        } catch (error) {
          console.error(
            "[media] Downloader request failed:",
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