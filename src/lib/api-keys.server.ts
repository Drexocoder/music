/** Server-only helpers for the public API key service. */

import {
  addDays,
  asObjectId,
  dayKey,
  defaultPlan,
  findApiKey,
  keyRow,
  monthStartKey,
  mongoCollection,
  planLimits,
  randomApiKey,
  type ApiKeyDocument,
  type ApiUsageDocument,
  type BotUserDocument,
  type MongoKeyRow,
} from "@/lib/mongodb.server";

type Quota =
  | { ok: true; used_today: number; used_month: number; daily_limit: number; monthly_limit: number; plan: string }
  | { ok: false; reason: string };

/** Kept as a small compatibility wrapper for the public status routes. */
export async function admin() {
  return import("@/lib/mongodb.server").then(({ mongoDb }) => mongoDb());
}

export async function consumeQuota(key: string): Promise<Quota> {
  const row = await findApiKey(key);
  if (!row) return { ok: false, reason: "invalid_key" };
  if (row.revoked) return { ok: false, reason: "revoked" };

  const now = new Date();
  if (row.expires_at <= now) return { ok: false, reason: "expired" };

  const usageCollection = await mongoCollection<ApiUsageDocument>("api_usage");
  const monthStart = monthStartKey(now);
  const today = dayKey(now);
  const usageRows = await usageCollection
    .find({ key_id: row._id, day: { $gte: monthStart } })
    .toArray();
  const usedToday = usageRows.find((usage) => usage.day === today)?.count ?? 0;
  const usedMonth = usageRows.reduce((sum, usage) => sum + usage.count, 0);

  if (usedToday >= row.daily_limit) return { ok: false, reason: "daily_limit" };
  if (usedMonth >= row.monthly_limit) return { ok: false, reason: "monthly_limit" };

  await usageCollection.updateOne(
    { key_id: row._id, day: today },
    {
      $inc: { count: 1 },
      $set: { updated_at: now },
      $setOnInsert: { created_at: now },
    },
    { upsert: true },
  );

  return {
    ok: true,
    used_today: usedToday + 1,
    used_month: usedMonth + 1,
    daily_limit: row.daily_limit,
    monthly_limit: row.monthly_limit,
    plan: row.plan,
  };
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

export async function upsertBotUser(
  telegramId: number,
  username: string | null,
  firstName: string | null,
) {
  const now = new Date();
  const users = await mongoCollection<BotUserDocument>("bot_users");
  await users.updateOne(
    { telegram_id: telegramId },
    {
      $set: { username, first_name: firstName, updated_at: now },
      $setOnInsert: { created_at: now },
    },
    { upsert: true },
  );
}

export type KeyRow = MongoKeyRow;

/** Owner-only: put a Telegram user on a plan for 30 days (creates a key if needed). */
export async function setUserPlan(
  telegramId: number,
  plan: string,
): Promise<
  | { ok: true; key: string; plan: string; daily_limit: number; monthly_limit: number; plan_expires_at: string | null }
  | { ok: false; reason: string }
> {
  let limits: ReturnType<typeof planLimits>;
  try {
    limits = planLimits(plan);
  } catch {
    return { ok: false, reason: "unknown_plan" };
  }

  const now = new Date();
  const planExpiresAt = plan === "free" ? null : addDays(now, 30);
  const keys = await mongoCollection<ApiKeyDocument>("api_keys");
  const result = await keys.findOneAndUpdate(
    { telegram_id: telegramId, revoked: false, expires_at: { $gt: now } },
    {
      $set: {
        ...limits,
        plan_expires_at: planExpiresAt,
      },
      $setOnInsert: {
        key: randomApiKey(),
        telegram_id: telegramId,
        revoked: false,
        expires_at: addDays(now, 30),
        created_at: now,
      },
    },
    { upsert: true, returnDocument: "after" },
  );

  if (!result) return { ok: false, reason: "server_error" };
  return {
    ok: true,
    key: result.key,
    plan: result.plan,
    daily_limit: result.daily_limit,
    monthly_limit: result.monthly_limit,
    plan_expires_at: result.plan_expires_at?.toISOString() ?? null,
  };
}

export async function activeKeyFor(telegramId: number): Promise<KeyRow | null> {
  const now = new Date();
  const keys = await mongoCollection<ApiKeyDocument>("api_keys");
  const row = await keys.findOne(
    { telegram_id: telegramId, revoked: false, expires_at: { $gt: now } },
    { sort: { created_at: -1 } },
  );
  return row ? keyRow(row) : null;
}

/** One free key per user per month. Returns the existing key if still valid. */
export async function issueKey(
  telegramId: number,
): Promise<{ key: KeyRow; created: boolean }> {
  const existing = await activeKeyFor(telegramId);
  if (existing) return { key: existing, created: false };

  const now = new Date();
  const defaults = defaultPlan();
  const row: Omit<ApiKeyDocument, "_id"> = {
    key: randomApiKey(),
    telegram_id: telegramId,
    ...defaults,
    revoked: false,
    expires_at: addDays(now, 30),
    plan_expires_at: null,
    created_at: now,
  };
  const keys = await mongoCollection<ApiKeyDocument>("api_keys");
  const result = await keys.insertOne(row as ApiKeyDocument);
  const inserted = await keys.findOne({ _id: result.insertedId });
  if (!inserted) throw new Error("Could not create API key");
  return { key: keyRow(inserted), created: true };
}

export async function revokeKeys(telegramId: number): Promise<number> {
  const keys = await mongoCollection<ApiKeyDocument>("api_keys");
  const result = await keys.updateMany(
    { telegram_id: telegramId, revoked: false },
    { $set: { revoked: true } },
  );
  return result.modifiedCount;
}

export async function usageFor(keyId: string): Promise<{ today: number; month: number }> {
  const usage = await mongoCollection<ApiUsageDocument>("api_usage");
  const now = new Date();
  const rows = await usage
    .find({ key_id: asObjectId(keyId), day: { $gte: monthStartKey(now) } })
    .toArray();
  const today = dayKey(now);
  return {
    today: rows.find((row) => row.day === today)?.count ?? 0,
    month: rows.reduce((sum, row) => sum + row.count, 0),
  };
}