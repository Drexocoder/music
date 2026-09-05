import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { BotUserDocument, TelegramMessageDocument } from "@/lib/mongodb.server";

const passcodeSchema = z.object({ passcode: z.string().min(1).max(200) });

function check(passcode: string) {
  const expected = process.env["TELEGRAM_ADMIN_PASSCODE"];
  if (!expected) throw new Error("Admin passcode is not configured.");
  if (passcode !== expected) throw new Error("Wrong passcode.");
}

export const adminLogin = createServerFn({ method: "POST" })
  .inputValidator((d) => passcodeSchema.parse(d))
  .handler(async ({ data }) => {
    check(data.passcode);
    return { ok: true as const };
  });

export const botStatus = createServerFn({ method: "POST" })
  .inputValidator((d) => passcodeSchema.parse(d))
  .handler(async ({ data }) => {
    check(data.passcode);
    const { tgCall } = await import("./telegram.server");
    const [me, hook] = await Promise.all([tgCall("getMe", {}), tgCall("getWebhookInfo", {})]);
    const meRes = (me.json?.["result"] ?? {}) as Record<string, unknown>;
    const hookRes = (hook.json?.["result"] ?? {}) as Record<string, unknown>;
    return {
      username: (meRes["username"] as string) ?? null,
      name: (meRes["first_name"] as string) ?? null,
      webhookUrl: (hookRes["url"] as string) ?? "",
      pending: (hookRes["pending_update_count"] as number) ?? 0,
      lastError: (hookRes["last_error_message"] as string) ?? null,
    };
  });

export type ChatSummary = {
  chat_id: number;
  name: string;
  last_text: string | null;
  last_at: string;
};

export const listChats = createServerFn({ method: "POST" })
  .inputValidator((d) => passcodeSchema.parse(d))
  .handler(async ({ data }): Promise<ChatSummary[]> => {
    check(data.passcode);
    const { mongoCollection } = await import("@/lib/mongodb.server");
    const rows = await (await mongoCollection<TelegramMessageDocument>("telegram_messages"))
      .find({})
      .sort({ created_at: -1 })
      .limit(400)
      .toArray();
    const seen = new Map<number, ChatSummary>();
    for (const r of rows) {
      const id = Number(r.chat_id);
      if (seen.has(id)) continue;
      const uname = r.username ?? null;
      const fname = r.first_name ?? null;
      seen.set(id, {
        chat_id: id,
        name: uname ? `@${uname}` : (fname ?? `Chat ${id}`),
        last_text: r.text ?? null,
        last_at: r.created_at.toISOString(),
      });
    }
    return [...seen.values()];
  });

export type ChatMessage = {
  id: string;
  direction: "in" | "out";
  text: string | null;
  kind: string | null;
  created_at: string;
};

export const listMessages = createServerFn({ method: "POST" })
  .inputValidator((d) => passcodeSchema.extend({ chatId: z.number() }).parse(d))
  .handler(async ({ data }): Promise<ChatMessage[]> => {
    check(data.passcode);
    const { mongoCollection } = await import("@/lib/mongodb.server");
    const rows = await (await mongoCollection<TelegramMessageDocument>("telegram_messages"))
      .find({ chat_id: data.chatId })
      .sort({ created_at: -1 })
      .limit(100)
      .toArray();
    return rows
      .slice()
      .reverse()
      .map((row) => ({
        id: row._id?.toHexString() ?? "",
        direction: row.direction,
        text: row.text ?? null,
        kind: row.kind ?? null,
        created_at: row.created_at.toISOString(),
      }));
  });

export const sendMessage = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    passcodeSchema.extend({ chatId: z.number(), text: z.string().min(1).max(4000) }).parse(d),
  )
  .handler(async ({ data }) => {
    check(data.passcode);
    const { tgCall, logMessage } = await import("./telegram.server");
    const res = await tgCall("sendMessage", {
      chat_id: data.chatId,
      text: data.text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
    if (!res.ok || res.json?.["ok"] === false) {
      const desc = (res.json?.["description"] as string) ?? `HTTP ${res.status}`;
      throw new Error(`Telegram refused the message: ${desc}`);
    }
    await logMessage({ chat_id: data.chatId, direction: "out", text: data.text, kind: "admin" });
    return { ok: true as const };
  });

export const broadcast = createServerFn({ method: "POST" })
  .inputValidator((d) => passcodeSchema.extend({ text: z.string().min(1).max(4000) }).parse(d))
  .handler(async ({ data }) => {
    check(data.passcode);
    const { tgCall, logMessage } = await import("./telegram.server");
    const { mongoCollection } = await import("@/lib/mongodb.server");
    const rows = await (await mongoCollection<BotUserDocument>("bot_users")).find({}).limit(2000).toArray();
    const ids = rows.map((row) => Number(row.telegram_id));
    let sent = 0;
    for (const id of ids) {
      const res = await tgCall("sendMessage", {
        chat_id: id,
        text: data.text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      });
      if (res.ok && res.json?.["ok"] !== false) {
        sent += 1;
        await logMessage({ chat_id: id, direction: "out", text: data.text, kind: "broadcast" });
      }
    }
    return { total: ids.length, sent };
  });
