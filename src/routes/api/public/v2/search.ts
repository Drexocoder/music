import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/v2/search")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const q = (url.searchParams.get("q") ?? url.searchParams.get("query") ?? "").trim();
        const key = url.searchParams.get("api_key") ?? url.searchParams.get("key") ?? "";
        if (!q || !key) {
          return Response.json({ ok: false, error: "q and api_key are required" }, { status: 400 });
        }

        const { consumeQuota, quotaMessage } = await import("@/lib/api-keys.server");
        const quota = await consumeQuota(key);
        if (!quota.ok) {
          return Response.json(
            { ok: false, error: quotaMessage(quota.reason) },
            { status: quota.reason === "invalid_key" ? 401 : 429 },
          );
        }

        const { ytSearch } = await import("@/lib/media.server");
        const { results, error } = await ytSearch(q);
        if (error && !results.length) {
          return Response.json({ ok: false, error }, { status: 502 });
        }

        return Response.json({
          ok: true,
          plan: {
            name: quota.plan,
            daily_limit: quota.daily_limit,
            monthly_limit: quota.monthly_limit,
            used_today: quota.used_today,
            used_month: quota.used_month,
            remaining_today: Math.max(0, quota.daily_limit - quota.used_today),
          },
          results,
        });
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
