import { createFileRoute } from "@tanstack/react-router";
import { FILE } from "@/lib/guide-youtube-py";

export const Route = createFileRoute("/api/public/guide/youtube.py")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = new URL(request.url).origin;
        return new Response(FILE.replaceAll("{ORIGIN}", origin), {
          headers: {
            "content-type": "text/x-python; charset=utf-8",
            "content-disposition": 'attachment; filename="youtube.py"',
            "cache-control": "no-store",
            "access-control-allow-origin": "*",
          },
        });
      },
    },
  },
});
