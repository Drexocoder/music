import { createFileRoute } from "@tanstack/react-router";
import { publicOrigin, telegramRequest, telegramWebhookSecret } from "@/lib/telegram.server";

/**
 * Register the bot webhook from inside the app runtime. This is intentionally
 * scoped to the current origin; callers cannot provide an arbitrary callback
 * URL or read the bot token.
 */
async function setupWebhook(request: Request) {
  const origin = publicOrigin(request);
  try {
    const telegramResponse = await telegramRequest("setWebhook", {
      url: `${origin}/api/public/telegram/webhook`,
      secret_token: telegramWebhookSecret(),
      drop_pending_updates: false,
    });
    const payload = (await telegramResponse.json()) as {
      ok?: boolean;
      description?: string;
    };

    return Response.json(
      {
        ok: payload.ok === true,
        description: payload.description ?? (payload.ok ? "Webhook registered." : "Telegram rejected the webhook."),
        webhook_url: `${origin}/api/public/telegram/webhook`,
      },
      { status: telegramResponse.ok && payload.ok !== false ? 200 : 502 },
    );
  } catch (error) {
    console.error("[telegram setup]", error);
    return Response.json({ ok: false, error: "Telegram bot is not configured on this server." }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/public/telegram/setup")({
  server: {
    handlers: {
      POST: ({ request }) => setupWebhook(request),
    },
  },
});