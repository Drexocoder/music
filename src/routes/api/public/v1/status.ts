import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/v1/status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const key = url.searchParams.get("api_key") ?? url.searchParams.get("key") ?? "";
        if (!key) return Response.json({ ok: false, error: "api_key required" }, { status: 400 });

        const { admin, usageFor } = await import("@/lib/api-keys.server");
        const db = await admin();
        const { data } = await db.from("api_keys").select("*").eq("key", key).limit(1);
        const row = data?.[0] as
          | {
              id: string;
              plan: string;
              daily_limit: number;
              monthly_limit: number;
              revoked: boolean;
              expires_at: string;
            }
          | undefined;
        if (!row) return Response.json({ ok: false, error: "Invalid API key" }, { status: 401 });

        const usage = await usageFor(row.id);
        return Response.json({
          ok: true,
          plan: row.plan,
          revoked: row.revoked,
          expires_at: row.expires_at,
          limits: { daily: row.daily_limit, monthly: row.monthly_limit },
          used: usage,
          remaining: {
            daily: Math.max(0, row.daily_limit - usage.today),
            monthly: Math.max(0, row.monthly_limit - usage.month),
          },
        });
      },
    },
  },
});
