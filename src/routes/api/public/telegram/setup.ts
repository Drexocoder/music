import { createFileRoute } from "@tanstack/react-router";
import {
  publicOrigin,
  telegramRequest,
  telegramWebhookSecret,
} from "@/lib/telegram.server";

/**
 * Register Telegram webhook using the production URL.
 *
 * Set PUBLIC_APP_URL in Vercel to:
 * https://nexoramusicv2.vercel.app
 *
 * The request origin is only used as a fallback.
 */
async function setupWebhook(request: Request) {
  const configuredOrigin =
    process.env["PUBLIC_APP_URL"]?.trim().replace(/\/+$/, "");

  const origin = configuredOrigin || publicOrigin(request);

  const webhookUrl = `${origin}/api/public/telegram/webhook`;

  try {
    if (
      !process.env["TELEGRAM_BOT_TOKEN"] &&
      !process.env["TELEGRAM_API_KEY"]
    ) {
      return Response.json(
        {
          ok: false,
          error: "TELEGRAM_BOT_TOKEN or TELEGRAM_API_KEY is missing.",
        },
        { status: 500 },
      );
    }

    console.log("[telegram setup] registering webhook:", webhookUrl);

    const telegramResponse = await telegramRequest("setWebhook", {
      url: webhookUrl,
      secret_token: telegramWebhookSecret(),
      drop_pending_updates: false,
    });

    const payload = (await telegramResponse.json()) as {
      ok?: boolean;
      description?: string;
    };

    console.log(
      "[telegram setup] Telegram response:",
      JSON.stringify(payload),
    );

    return Response.json(
      {
        ok: telegramResponse.ok && payload.ok === true,

        description:
          payload.description ??
          (payload.ok
            ? "Webhook registered successfully."
            : "Telegram rejected the webhook."),

        webhook_url: webhookUrl,

        status: telegramResponse.status,
      },
      {
        status: telegramResponse.ok && payload.ok !== false ? 200 : 502,
      },
    );
  } catch (error) {
    console.error("[telegram setup] failed:", error);

    return Response.json(
      {
        ok: false,
        error: "Failed to register Telegram webhook.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

export const Route = createFileRoute("/api/public/telegram/setup")({
  server: {
    handlers: {
      // POST
      POST: ({ request }) => setupWebhook(request),

      // GET — makes it possible to open the setup URL directly in a browser.
      GET: ({ request }) => setupWebhook(request),
    },
  },
});
