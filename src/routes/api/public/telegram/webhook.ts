import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "crypto";
import { OWNER_TELEGRAM_ID, PLANS, SUPPORT_HANDLE, planById } from "@/lib/plans";
import { FILE as YOUTUBE_GUIDE } from "@/lib/guide-youtube-py";
import { publicOrigin, telegramRequest, telegramWebhookSecret } from "@/lib/telegram.server";

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function tg(method: string, body: unknown) {
  const res = await telegramRequest(method, body);
  if (!res.ok) {
    console.error(`Telegram ${method} failed [${res.status}]: ${await res.text()}`);
  }
  return res;
}

const HELP = [
  "🎧 <b>Nex Music API</b>",
  "",
  "<b>/key</b> — generate your free API key",
  "<b>/mykey</b> — show your current key",
  "<b>/usage</b> — quota left today and this month",
  "<b>/plans</b> — plans and prices",
  "<b>/guide</b> — get <code>youtube.py</code> with full code",
  "<b>/revoke</b> — cancel your key",
  "",
  "<b>/song &lt;name or link&gt;</b> — get the audio file",
  "<b>/video &lt;name or link&gt;</b> — get the video file",
  "<b>/search &lt;name&gt;</b> — list top results",
  "",
  "Or just send me a song name.",
].join("\n");

function plansText(): string {
  return [
    "💎 <b>Plans</b>",
    "",
    ...PLANS.map((p) =>
      [
        `<b>${p.label}</b> — ${p.priceInr === 0 ? "Free" : `₹${p.priceInr}/month`}`,
        `${p.daily.toLocaleString("en-IN")} requests/day · ${p.monthly.toLocaleString("en-IN")}/month`,
        p.perks.map((x) => `• ${x}`).join("\n"),
        "",
      ].join("\n"),
    ),
    `Paid plans stay active for 30 days, then your key drops back to Free automatically.`,
    "",
    `To buy, contact ${SUPPORT_HANDLE}.`,
  ].join("\n");
}

function mainKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "🔑 Get free key", callback_data: "key" },
        { text: "💎 Plans", callback_data: "plans" },
      ],
      [
        { text: "📄 youtube.py guide", callback_data: "guide" },
        { text: "📊 My usage", callback_data: "usage" },
      ],
      [
        { text: "🛒 Buy a plan", callback_data: "buy" },
        { text: "❓ Help", callback_data: "help" },
      ],
    ],
  };
}

function plansKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "🛒 How to buy", callback_data: "buy" }],
      [{ text: "🔑 Get free key", callback_data: "key" }],
    ],
  };
}

function background(promise: Promise<unknown>) {
  const wu = (globalThis as unknown as { __wait_until__?: (p: Promise<unknown>) => void })
    .__wait_until__;
  if (typeof wu === "function") {
    try {
      wu(promise);
      return;
    } catch {
      // fall through
    }
  }
  promise.catch((err) => console.error("[bot bg]", err));
}

type Update = {
  message?: {
    chat?: { id?: number };
    from?: { id?: number; username?: string; first_name?: string };
    text?: string;
  };
  callback_query?: {
    id?: string;
    data?: string;
    from?: { id?: number; username?: string; first_name?: string };
    message?: { chat?: { id?: number } };
  };
};

async function handleUpdate(update: Update, origin: string) {
  const cb = update.callback_query;
  const msg = update.message;
  const chatId = msg?.chat?.id ?? cb?.message?.chat?.id;
  const from = msg?.from ?? cb?.from;
  const fromId = from?.id;
  const text = (cb ? `/${cb.data ?? ""}` : (msg?.text ?? "")).trim();
  if (!chatId || !fromId || !text) return;

  // Instant feedback: ack callback and show typing indicator in parallel.
  const acks: Promise<unknown>[] = [];
  if (cb?.id) acks.push(tg("answerCallbackQuery", { callback_query_id: cb.id }));
  acks.push(tg("sendChatAction", { chat_id: chatId, action: "typing" }));

  const [{ upsertBotUser, issueKey, activeKeyFor, revokeKeys, usageFor, setUserPlan }, media] =
    await Promise.all([
      import("@/lib/api-keys.server"),
      import("@/lib/media.server"),
      Promise.all(acks).catch(() => undefined),
    ]);
  const { ytSearch, extractVideoId, ytMeta, providerConfigured } = media;

  // Fire-and-forget: don't block the reply on the user upsert.
  background(upsertBotUser(fromId, from?.username ?? null, from?.first_name ?? null));

  const log = async (entry: {
    direction: "in" | "out";
    text?: string | null;
    kind?: string | null;
  }) => {
    const { logMessage } = await import("@/lib/telegram.server");
    await logMessage({
      chat_id: chatId,
      telegram_user_id: fromId,
      username: from?.username ?? null,
      first_name: from?.first_name ?? null,
      ...entry,
    });
  };

  background(log({ direction: "in", text, kind: cb ? "button" : "message" }));

  const [rawCmd, ...rest] = text.split(/\s+/);
  const cmd = (rawCmd ?? "").toLowerCase().split("@")[0];
  const arg = rest.join(" ").trim();

  const say = (t: string, keyboard?: unknown) => {
    background(log({ direction: "out", text: t, kind: "bot" }));
    return tg("sendMessage", {
      chat_id: chatId,
      text: t,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...(keyboard ? { reply_markup: keyboard } : {}),
    });
  };


  if (cmd === "/start" || cmd === "/help" || cmd === "/menu") {
    await say(HELP, mainKeyboard());
    return;
  }

  if (cmd === "/plans" || cmd === "/plan" || cmd === "/buy") {
    await say(plansText(), plansKeyboard());
    return;
  }

  if (cmd === "/guide" || cmd === "/docs") {
    const guide = new FormData();
    guide.append("chat_id", String(chatId));
    guide.append(
      "document",
      new Blob([YOUTUBE_GUIDE.replaceAll("{ORIGIN}", origin)], {
        type: "text/x-python",
      }),
      "youtube.py",
    );
    guide.append(
      "caption",
      [
        "📄 <b>youtube.py</b> — drop this into your music bot.",
        "",
        "1. <code>pip install aiohttp</code>",
        "2. Put your key in <code>NEX_API_KEY</code> (or edit the file).",
        "3. <code>from youtube import search, download_song, download_video</code>",
      ].join("\n"),
    );
    guide.append("parse_mode", "HTML");
    await tg("sendDocument", guide);
    return;
  }

  if (cmd === "/permit") {
    if (fromId !== OWNER_TELEGRAM_ID) {
      await say("This command is for the owner only.");
      return;
    }
    const [planArg, idArg] = rest;
    const plan = (planArg ?? "").toLowerCase();
    const targetId = Number(idArg);
    if (!PLANS.some((p) => p.id === plan) || !Number.isFinite(targetId) || !targetId) {
      await say("Usage: <code>/permit gold 123456789</code>\nPlans: free, silver, gold, platinum");
      return;
    }
    const result = await setUserPlan(targetId, plan);
    if (!result.ok) {
      await say(`Couldn't set the plan (${result.reason}).`);
      return;
    }
    await Promise.all([
      say(
        [
          `✅ <b>${planById(plan).label}</b> granted to <code>${targetId}</code>`,
          `Limits: <b>${result.daily_limit}</b>/day · <b>${result.monthly_limit}</b>/month`,
          result.plan_expires_at
            ? `Active until: <b>${new Date(result.plan_expires_at).toDateString()}</b>`
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
      ),
      tg("sendMessage", {
        chat_id: targetId,
        text: [
          `🎉 Your plan is now <b>${planById(plan).label}</b>.`,
          `Limits: <b>${result.daily_limit}</b>/day · <b>${result.monthly_limit}</b>/month`,
          result.plan_expires_at
            ? `Active until <b>${new Date(result.plan_expires_at).toDateString()}</b>, then it returns to Free.`
            : "",
          "",
          `Key: <code>${result.key}</code>`,
        ]
          .filter(Boolean)
          .join("\n"),
        parse_mode: "HTML",
      }),
    ]);
    return;
  }

  if (cmd === "/key" || cmd === "/genkey") {
    const { key, created } = await issueKey(fromId);
    const plan = planById(key.plan);
    await say(
      [
        created ? "✅ <b>Your API key is ready</b>" : "ℹ️ <b>You already have a key</b>",
        "",
        `<code>${key.key}</code>`,
        "",
        `Plan: <b>${plan.label}</b>`,
        `Limits: <b>${key.daily_limit}</b>/day · <b>${key.monthly_limit}</b>/month`,
        `Valid until: <b>${new Date(key.expires_at).toDateString()}</b>`,
        "",
        `Need more? Send /plans.`,
      ].join("\n"),
      mainKeyboard(),
    );
    return;
  }

  if (cmd === "/mykey") {
    const key = await activeKeyFor(fromId);
    await say(
      key
        ? `<code>${key.key}</code>\n\nPlan: <b>${planById(key.plan).label}</b>\nValid until <b>${new Date(key.expires_at).toDateString()}</b>`
        : "You don't have an active key. Send /key to generate one.",
    );
    return;
  }

  if (cmd === "/usage") {
    const key = await activeKeyFor(fromId);
    if (!key) {
      await say("You don't have an active key. Send /key to generate one.");
      return;
    }
    const usage = await usageFor(key.id);
    await say(
      [
        "📊 <b>Usage</b>",
        `Plan: <b>${planById(key.plan).label}</b>`,
        `Today: <b>${usage.today}</b> / ${key.daily_limit}`,
        `This month: <b>${usage.month}</b> / ${key.monthly_limit}`,
        key.plan_expires_at
          ? `Plan active until <b>${new Date(key.plan_expires_at).toDateString()}</b>`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
      plansKeyboard(),
    );
    return;
  }

  if (cmd === "/revoke") {
    const n = await revokeKeys(fromId);
    await say(n ? "🔒 Your key has been revoked." : "You had no active key.");
    return;
  }

  if (cmd === "/search") {
    if (!arg) {
      await say("Usage: /search despacito");
      return;
    }
    const { results, error } = await ytSearch(arg);
    if (!results.length) {
      await say(error ?? "No results found.");
      return;
    }
    await say(
      ["🔎 <b>Results</b>", ""]
        .concat(
          results
            .slice(0, 8)
            .map(
              (r, i) =>
                `${i + 1}. <b>${r.title}</b>${r.duration ? ` · ${r.duration}` : ""}\n<code>/song https://youtu.be/${r.id}</code>`,
            ),
        )
        .join("\n"),
    );
    return;
  }

  // /song, /video, or a plain song name
  const wantsVideo = cmd === "/video" || cmd === "/vid";
  const query =
    cmd === "/song" || cmd === "/play" || wantsVideo ? arg : text.startsWith("/") ? "" : text;

  if (!query) {
    await say(HELP, mainKeyboard());
    return;
  }

  // Resolve video + key in parallel — key lookup and search don't depend on each other.
  const directId = extractVideoId(query);
  const [key, resolved] = await Promise.all([
    activeKeyFor(fromId),
    directId
      ? ytMeta(directId).then((m) => ({ id: directId, title: m?.title ?? directId, error: null as string | null }))
      : ytSearch(query).then((r) => {
          const first = r.results[0];
          return first
            ? { id: first.id, title: first.title, error: null as string | null }
            : { id: "", title: "", error: r.error ?? "Couldn't find that one. Try a different name." };
        }),
  ]);

  if (!key) {
    await say("You need a key first. Send /key to generate your free one.", mainKeyboard());
    return;
  }
  if (!resolved.id) {
    await say(resolved.error ?? "Couldn't find that one. Try a different name.");
    return;
  }
  const { id: videoId, title } = resolved;

  if (!providerConfigured()) {
    await say(
      [
        `🎵 <b>${title}</b>`,
        "",
        "Downloads are unavailable on this deployment. Please try again later.",
      ].join("\n"),
    );
    return;
  }

  // Keep the typing indicator alive while Telegram fetches the file — no extra "Fetching…" message.
  background(tg("sendChatAction", { chat_id: chatId, action: wantsVideo ? "upload_video" : "upload_voice" }));

  const fileUrl = `${origin}/api/public/v2/download?api_key=${encodeURIComponent(key.key)}&url=${videoId}&type=${wantsVideo ? "video" : "audio"}`;

  const res = wantsVideo
    ? await tg("sendVideo", { chat_id: chatId, video: fileUrl, caption: title })
    : await tg("sendAudio", { chat_id: chatId, audio: fileUrl, title, caption: title });

  if (!res.ok) {
    await say("😕 Couldn't send that file. It may be larger than Telegram's file limit; try another result.");
  }
}

export const Route = createFileRoute("/api/public/telegram/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!process.env["TELEGRAM_BOT_TOKEN"] && !process.env["TELEGRAM_API_KEY"]) {
          return new Response("Not configured", { status: 500 });
        }

        const provided = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
        if (!safeEqual(provided, telegramWebhookSecret())) {
          return new Response("Unauthorized", { status: 401 });
        }

        const update = (await request.json()) as Update;
        const origin = publicOrigin(request);

        // Await the handler: Vercel may freeze a function as soon as a response
        // is returned, so fire-and-forget work is not reliable there.
        try {
          await handleUpdate(update, origin);
        } catch (error) {
          console.error("[telegram update]", error);
          const chatId = update.message?.chat?.id ?? update.callback_query?.message?.chat?.id;
          if (chatId) {
            await tg("sendMessage", {
              chat_id: chatId,
              text: "⚠️ The bot is temporarily unable to access key storage. Please try again shortly.",
            }).catch((sendError) => console.error("[telegram error reply]", sendError));
          }
        }
        return Response.json({ ok: true });
      },
    },
  },
});
