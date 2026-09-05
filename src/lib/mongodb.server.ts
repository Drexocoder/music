import { MongoClient, ObjectId, type Collection, type Document } from "mongodb";
import { PLANS, planById } from "@/lib/plans";

export type ApiKeyDocument = {
  _id: ObjectId;
  key: string;
  telegram_id: number;
  plan: string;
  daily_limit: number;
  monthly_limit: number;
  revoked: boolean;
  expires_at: Date;
  plan_expires_at: Date | null;
  created_at: Date;
};

export type BotUserDocument = {
  _id?: ObjectId;
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  created_at: Date;
  updated_at: Date;
};

export type ApiUsageDocument = {
  _id?: ObjectId;
  key_id: ObjectId;
  day: string;
  count: number;
  created_at: Date;
  updated_at: Date;
};

export type TelegramMessageDocument = {
  _id?: ObjectId;
  update_id?: number;
  chat_id: number;
  telegram_user_id?: number | null;
  username?: string | null;
  first_name?: string | null;
  direction: "in" | "out";
  text?: string | null;
  kind?: string | null;
  created_at: Date;
};

let clientPromise: Promise<MongoClient> | undefined;
let indexesPromise: Promise<void> | undefined;

function mongoUri(): string {
  const uri = process.env["MONGODB_URI"]?.trim();
  if (!uri) throw new Error("Missing MONGODB_URI environment variable.");
  return uri;
}

function databaseName(uri: string): string {
  const configured = process.env["MONGODB_DB_NAME"]?.trim();
  if (configured) return configured;

  const pathname = new URL(uri).pathname.replace(/^\/+/, "");
  if (!pathname) {
    throw new Error("MONGODB_DB_NAME is required when MONGODB_URI has no database name.");
  }
  return decodeURIComponent(pathname);
}

async function connectedClient(): Promise<MongoClient> {
  if (!clientPromise) {
    const client = new MongoClient(mongoUri(), {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 8000,
    });
    clientPromise = client.connect().catch((error) => {
      clientPromise = undefined;
      throw error;
    });
  }
  return clientPromise;
}

async function ensureIndexes(db: Awaited<ReturnType<MongoClient["db"]>>): Promise<void> {
  await Promise.all([
    db.collection<ApiKeyDocument>("api_keys").createIndexes([
      { key: { key: 1 }, unique: true },
      { key: { telegram_id: 1, revoked: 1, expires_at: -1 } },
    ]),
    db.collection<BotUserDocument>("bot_users").createIndex({ telegram_id: 1 }, { unique: true }),
    db.collection<ApiUsageDocument>("api_usage").createIndexes([
      { key: { key_id: 1, day: 1 }, unique: true },
      { key: { day: 1 } },
    ]),
    db.collection<TelegramMessageDocument>("telegram_messages").createIndexes([
      { key: { chat_id: 1, created_at: -1 } },
      { key: { created_at: -1 } },
      {
        key: { update_id: 1 },
        unique: true,
        sparse: true,
      },
    ]),
  ]).then(() => undefined);
}

export async function mongoDb() {
  const client = await connectedClient();
  const db = client.db(databaseName(mongoUri()));
  if (!indexesPromise) {
    indexesPromise = ensureIndexes(db).catch((error) => {
      indexesPromise = undefined;
      throw error;
    });
  }
  await indexesPromise;
  return db;
}

export async function mongoCollection<T extends Document>(name: string): Promise<Collection<T>> {
  return (await mongoDb()).collection<T>(name);
}

export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function monthStartKey(date: Date): string {
  return `${date.toISOString().slice(0, 7)}-01`;
}

export function asObjectId(id: string): ObjectId {
  if (!ObjectId.isValid(id)) throw new Error("Invalid MongoDB document id.");
  return new ObjectId(id);
}

export function keyRow(doc: ApiKeyDocument) {
  return {
    id: doc._id.toHexString(),
    key: doc.key,
    plan: doc.plan,
    daily_limit: doc.daily_limit,
    monthly_limit: doc.monthly_limit,
    revoked: doc.revoked,
    expires_at: doc.expires_at.toISOString(),
    plan_expires_at: doc.plan_expires_at?.toISOString() ?? null,
    created_at: doc.created_at.toISOString(),
  };
}

export type MongoKeyRow = ReturnType<typeof keyRow>;

export async function findApiKey(value: string): Promise<ApiKeyDocument | null> {
  const collection = await mongoCollection<ApiKeyDocument>("api_keys");
  return collection.findOne({ key: value });
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function planLimits(planId: string) {
  const plan = planById(planId);
  return {
    plan: plan.id,
    daily_limit: plan.daily,
    monthly_limit: plan.monthly,
  };
}

export function randomApiKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `Nex-${hex}`;
}

export function defaultPlan() {
  return planLimits(PLANS[0]!.id);
}