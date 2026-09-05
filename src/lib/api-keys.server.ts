/** Server-only helpers for the public API key service. */

type Quota =
  | { ok: true; used_today: number; used_month: number; daily_limit: number; monthly_limit: number; plan: string }
  | { ok: false; reason: string };

export async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export async function consumeQuota(key: string): Promise<Quota> {
  const db = await admin();
  const { data, error } = await db.rpc("consume_api_quota" as never, { _key: key } as never);
  if (error) return { ok: false, reason: "server_error" };
  return data as unknown as Quota;
}

export function quotaMessage(reason: string): string {
  switch (reason) {
    case "invalid_key":
      return "Invalid API key.";
    case "revoked":
      return "This API key has been revoked.";
    case "expired":
      return "This API key has expired. Generate a new one from the bot.";
    case "daily_limit":
      return "Daily request limit reached. Try again tomorrow.";
    case "monthly_limit":
      return "Monthly request limit reached.";
    default:
      return "Could not verify your API key.";
  }
}

function randomKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `Nex-${hex}`;
}


export async function upsertBotUser(
  telegramId: number,
  username: string | null,
  firstName: string | null,
) {
  const db = await admin();
  await db
    .from("bot_users")
    .upsert(
      { telegram_id: telegramId, username, first_name: firstName },
      { onConflict: "telegram_id" },
    );
}

export type KeyRow = {
  id: string;
  key: string;
  plan: string;
  daily_limit: number;
  monthly_limit: number;
  revoked: boolean;
  expires_at: string;
  plan_expires_at: string | null;
  created_at: string;
};

/** Owner-only: put a Telegram user on a plan for 30 days (creates a key if needed). */
export async function setUserPlan(
  telegramId: number,
  plan: string,
): Promise<
  | { ok: true; key: string; plan: string; daily_limit: number; monthly_limit: number; plan_expires_at: string | null }
  | { ok: false; reason: string }
> {
  const db = await admin();
  const { data, error } = await db.rpc("set_user_plan" as never, {
    _telegram_id: telegramId,
    _plan: plan,
  } as never);
  if (error) return { ok: false, reason: "server_error" };
  return data as never;
}


export async function activeKeyFor(telegramId: number): Promise<KeyRow | null> {
  const db = await admin();
  const { data } = await db
    .from("api_keys")
    .select("*")
    .eq("telegram_id", telegramId)
    .eq("revoked", false)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1);
  return (data?.[0] as KeyRow | undefined) ?? null;
}

/** One free key per user per month. Returns the existing key if still valid. */
export async function issueKey(
  telegramId: number,
): Promise<{ key: KeyRow; created: boolean }> {
  const existing = await activeKeyFor(telegramId);
  if (existing) return { key: existing, created: false };

  const db = await admin();
  const { data, error } = await db
    .from("api_keys")
    .insert({ key: randomKey(), telegram_id: telegramId })
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not create key");
  return { key: data as KeyRow, created: true };
}

export async function revokeKeys(telegramId: number): Promise<number> {
  const db = await admin();
  const { data } = await db
    .from("api_keys")
    .update({ revoked: true })
    .eq("telegram_id", telegramId)
    .eq("revoked", false)
    .select("id");
  return data?.length ?? 0;
}

export async function usageFor(keyId: string): Promise<{ today: number; month: number }> {
  const db = await admin();
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
  const today = now.toISOString().slice(0, 10);
  const { data } = await db
    .from("api_usage")
    .select("day, count")
    .eq("key_id", keyId)
    .gte("day", monthStart);
  const rows = (data ?? []) as Array<{ day: string; count: number }>;
  return {
    today: rows.find((r) => r.day === today)?.count ?? 0,
    month: rows.reduce((sum, r) => sum + r.count, 0),
  };
}
