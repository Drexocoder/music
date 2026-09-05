import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin
      .from("telegram_messages")
      .select("chat_id, text, created_at, username, first_name")
      .order("created_at", { ascending: false })
      .limit(400);
    const seen = new Map<number, ChatSummary>();
    for (const r of (rows ?? []) as Array<Record<string, unknown>>) {
      const id = Number(r["chat_id"]);
      if (seen.has(id)) continue;
      const uname = r["username"] as string | null;
      const fname = r["first_name"] as string | null;
      seen.set(id, {
        chat_id: id,
        name: uname ? `@${uname}` : (fname ?? `Chat ${id}`),
        last_text: (r["text"] as string | null) ?? null,
        last_at: String(r["created_at"]),
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin
      .from("telegram_messages")
      .select("id, direction, text, kind, created_at")
      .eq("chat_id", data.chatId)
      .order("created_at", { ascending: false })
      .limit(100);
    return ((rows ?? []) as unknown as ChatMessage[]).slice().reverse();
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin
      .from("bot_users")
      .select("telegram_id")
      .limit(2000);
    const ids = ((rows ?? []) as Array<Record<string, unknown>>).map((r) => Number(r["telegram_id"]));
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
