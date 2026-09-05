/** Server-only Telegram helpers: gateway calls + message logging. */

export const TELEGRAM_GATEWAY = "https://connector-gateway.lovable.dev/telegram";

export async function tgCall(method: string, body: unknown) {
  const res = await fetch(`${TELEGRAM_GATEWAY}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env["LOVABLE_API_KEY"]}`,
      "X-Connection-Api-Key": `${process.env["TELEGRAM_API_KEY"]}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("telegram_messages").insert({
      chat_id: entry.chat_id,
      direction: entry.direction,
      text: entry.text ?? null,
      kind: entry.kind ?? null,
      update_id: entry.update_id ?? null,
      telegram_user_id: entry.telegram_user_id ?? null,
      username: entry.username ?? null,
      first_name: entry.first_name ?? null,
    } as never);
  } catch (err) {
    console.error("[telegram log]", err);
  }
}
