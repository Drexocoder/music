import { MongoClient, ObjectId, type Collection, type Document } from "mongodb";
import { PLANS, planById } from "@/lib/plans";

export type ApiKeyDocument = {
  _id: ObjectId;
  record_type?: "api_key";
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
  record_type?: "bot_user";
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  created_at: Date;
  updated_at: Date;
};

export type ApiUsageDocument = {
  _id?: ObjectId;
  record_type?: "usage";
  key_id: ObjectId;
  day: string;
  count: number;
  created_at: Date;
  updated_at: Date;
};

export type TelegramMessageDocument = {
  _id?: ObjectId;
  record_type?: "telegram_message";
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

export async function mongoDb() {
  const client = await connectedClient();
  const db = client.db(databaseName(mongoUri()));
  return db;
}

export async function mongoCollection<T extends Document>(name: string): Promise<Collection<T>> {
  const storageName = process.env["MONGODB_COLLECTION"]?.trim() || "aurora_records";
  return (await mongoDb()).collection<T>(storageName);
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
  return collection.findOne({ record_type: "api_key", key: value });
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