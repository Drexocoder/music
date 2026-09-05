import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const schema = z.object({ q: z.string().min(1).max(120), key: z.string().min(8).max(80) });

export const Route = createFileRoute("/api/public/v1/search")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const parsed = schema.safeParse({
          q: url.searchParams.get("q") ?? "",
          key: url.searchParams.get("api_key") ?? url.searchParams.get("key") ?? "",
        });
        if (!parsed.success) {
          return Response.json({ ok: false, error: "q and api_key are required" }, { status: 400 });
        }

        const { consumeQuota, quotaMessage } = await import("@/lib/api-keys.server");
        const quota = await consumeQuota(parsed.data.key);
        if (!quota.ok) {
          return Response.json(
            { ok: false, error: quotaMessage(quota.reason) },
            { status: quota.reason === "invalid_key" ? 401 : 429 },
          );
        }

        const { ytSearch } = await import("@/lib/media.server");
        const { results, error } = await ytSearch(parsed.data.q);
        return Response.json({
          ok: !error,
          error: error ?? null,
          results,
          usage: { today: quota.used_today, month: quota.used_month },
        });
      },
    },
  },
});
