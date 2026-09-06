/** Server-only Telegram helpers: direct Bot API calls + message logging. */

import { createHash } from "crypto";

function botToken(): string {
  const token = (process.env["TELEGRAM_BOT_TOKEN"] ?? process.env["TELEGRAM_API_KEY"])?.trim();
  if (!token) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN environment variable.");
  }
  return token;
}

/**
 * Telegram only accepts a secret token when it is configured with setWebhook.
 * Keep a deterministic fallback so the webhook can be configured with one
 * curl command, while allowing operators to rotate it independently.
 */
export function telegramWebhookSecret(): string {
  const configured = process.env["TELEGRAM_WEBHOOK_SECRET"];
  if (configured) return configured;
  return createHash("sha256").update(`telegram-webhook:${botToken()}`).digest("base64url");
}

/** Build a Telegram-reachable origin from the public proxy headers. */
export function publicOrigin(request: Request): string {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host");
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProto === "http" || forwardedProto === "https" ? forwardedProto : "https";
  if (host) return `${protocol}://${host}`;
  return new URL(request.url).origin.replace(/^http:/, "https:");
}

export async function telegramRequest(method: string, body: unknown) {
  const isMultipart = typeof FormData !== "undefined" && body instanceof FormData;
  const res = await fetch(`https://api.telegram.org/bot${botToken()}/${method}`, {
    method: "POST",
    ...(isMultipart ? {} : { headers: { "Content-Type": "application/json" } }),
    body: (isMultipart ? body : JSON.stringify(body)) as BodyInit,
  });
  return res;
}

export async function tgCall(method: string, body: unknown) {
  const res = await telegramRequest(method, body);
  const text = await res.text();
  if (!res.ok) console.error(`Telegram ${method} failed [${res.status}]: ${text}`);
  try {
    return { ok: res.ok, status: res.status, json: JSON.parse(text) as Record<string, unknown> };
  } catch {
    return { ok: res.ok, status: res.status, json: {} as Record<string, unknown> };
  }
}

export type LogEntry = {
  chat_id: number;
  direction: "in" | "out";
  text?: string | null;
  kind?: string | null;
  update_id?: number | null;
  telegram_user_id?: number | null;
  username?: string | null;
  first_name?: string | null;
};

export async function logMessage(entry: LogEntry) {
  try {
    const { mongoCollection } = await import("@/lib/mongodb.server");
    await (await mongoCollection("telegram_messages")).insertOne({
      record_type: "telegram_message",
      chat_id: entry.chat_id,
      direction: entry.direction,
      text: entry.text ?? null,
      kind: entry.kind ?? null,
      update_id: entry.update_id ?? null,
      telegram_user_id: entry.telegram_user_id ?? null,
      username: entry.username ?? null,
      first_name: entry.first_name ?? null,
      created_at: new Date(),
    });
  } catch (err) {
    console.error("[telegram log]", err);
  }
}
