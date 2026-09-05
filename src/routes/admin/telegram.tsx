import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  adminLogin,
  botStatus,
  broadcast,
  listChats,
  listMessages,
  sendMessage,
  type ChatMessage,
  type ChatSummary,
} from "@/lib/telegram-admin.functions";

export const Route = createFileRoute("/admin/telegram")({
  head: () => ({
    meta: [
      { title: "Bot Control Room — Aurora Telegram Admin" },
      {
        name: "description",
        content:
          "Private control room for the Aurora Telegram bot: watch incoming chats, reply instantly, broadcast announcements and check webhook health.",
      },
      { property: "og:title", content: "Bot Control Room — Aurora Telegram Admin" },
      {
        property: "og:description",
        content: "Reply to bot chats, broadcast messages and check bot health in one place.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: TelegramAdmin,
});

const STORE_KEY = "aurora-tg-admin-pass";

function TelegramAdmin() {
  const login = useServerFn(adminLogin);
  const status = useServerFn(botStatus);
  const chats = useServerFn(listChats);
  const messages = useServerFn(listMessages);
  const send = useServerFn(sendMessage);
  const blast = useServerFn(broadcast);

  const [passcode, setPasscode] = useState("");
  const [authed, setAuthed] = useState(false);
  const [info, setInfo] = useState<Awaited<ReturnType<typeof botStatus>> | null>(null);
  const [chatList, setChatList] = useState<ChatSummary[]>([]);
  const [activeChat, setActiveChat] = useState<number | null>(null);
  const [thread, setThread] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [manualId, setManualId] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  async function unlock(code: string) {
    try {
      await login({ data: { passcode: code } });
      sessionStorage.setItem(STORE_KEY, code);
      setPasscode(code);
      setAuthed(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not unlock");
    }
  }

  useEffect(() => {
    const saved = sessionStorage.getItem(STORE_KEY);
    if (saved) void unlock(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll chats + bot health while unlocked.
  useEffect(() => {
    if (!authed) return;
    let alive = true;
    const tick = async () => {
      try {
        const [s, c] = await Promise.all([
          status({ data: { passcode } }),
          chats({ data: { passcode } }),
        ]);
        if (!alive) return;
        setInfo(s);
        setChatList(c);
        setActiveChat((prev) => prev ?? c[0]?.chat_id ?? null);
      } catch {
        /* ignore transient */
      }
    };
    void tick();
    const t = setInterval(tick, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, passcode]);

  // Poll the open conversation.
  useEffect(() => {
    if (!authed || activeChat == null) return;
    let alive = true;
    const tick = async () => {
      try {
        const m = await messages({ data: { passcode, chatId: activeChat } });
        if (alive) setThread(m);
      } catch {
        /* ignore */
      }
    };
    void tick();
    const t = setInterval(tick, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, activeChat, passcode]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [thread.length]);

  if (!authed) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
        <h1 className="text-2xl font-semibold tracking-tight">Bot control room</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Enter the admin passcode to open your Telegram bot panel.
        </p>
        <form
          className="mt-6 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void unlock(passcode);
          }}
        >
          <Input
            type="password"
            autoFocus
            placeholder="Passcode"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
          />
          <Button type="submit" className="w-full">
            Unlock
          </Button>
        </form>
        <Link to="/" className="mt-6 text-sm text-muted-foreground hover:text-foreground">
          ← Back to the player
        </Link>
      </main>
    );
  }

  const healthy = Boolean(info?.webhookUrl);

  return (
    <main className="mx-auto max-w-6xl px-5 py-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Bot control room</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {info?.username ? `@${info.username}` : "Loading bot…"}
            {" · "}
            <span className={healthy ? "text-emerald-400" : "text-red-400"}>
              {healthy ? "live" : "webhook not set"}
            </span>
            {info ? ` · ${info.pending} waiting` : ""}
          </p>
          {info?.lastError ? (
            <p className="mt-1 text-xs text-red-400">Last error: {info.lastError}</p>
          ) : null}
        </div>
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← Back to the player
        </Link>
      </header>

      <div className="mt-8 grid gap-6 lg:grid-cols-[260px_1fr]">
        <aside className="space-y-3">
          <div className="rounded-xl border border-border bg-surface-2/40 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Open a chat by ID
            </p>
            <form
              className="mt-2 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const id = Number(manualId);
                if (Number.isFinite(id) && id !== 0) {
                  setActiveChat(id);
                  setManualId("");
                }
              }}
            >
              <Input
                value={manualId}
                onChange={(e) => setManualId(e.target.value)}
                placeholder="123456789"
                inputMode="numeric"
              />
              <Button type="submit" variant="secondary">
                Go
              </Button>
            </form>
          </div>

          <div className="rounded-xl border border-border bg-surface-2/40">
            <p className="border-b border-border px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Conversations
            </p>
            <ul className="max-h-[420px] overflow-y-auto">
              {chatList.length === 0 ? (
                <li className="px-3 py-4 text-sm text-muted-foreground">
                  No messages yet. Say /start to your bot and it will show up here.
                </li>
              ) : (
                chatList.map((c) => (
                  <li key={c.chat_id}>
                    <button
                      type="button"
                      onClick={() => setActiveChat(c.chat_id)}
                      className={`w-full px-3 py-2 text-left text-sm transition-colors hover:bg-surface-2 ${
                        activeChat === c.chat_id ? "bg-surface-2 text-foreground" : "text-muted-foreground"
                      }`}
                    >
                      <span className="block truncate font-medium text-foreground">{c.name}</span>
                      <span className="block truncate text-xs">{c.last_text ?? "—"}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        </aside>

        <section className="space-y-6">
          <div className="flex h-[440px] flex-col rounded-xl border border-border bg-surface-2/40">
            <div className="flex-1 space-y-2 overflow-y-auto p-4">
              {thread.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {activeChat == null ? "Pick a conversation." : "No messages in this chat yet."}
                </p>
              ) : (
                thread.map((m) => (
                  <div
                    key={m.id}
                    className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                      m.direction === "out"
                        ? "ml-auto bg-primary text-primary-foreground"
                        : "bg-surface-2 text-foreground"
                    }`}
                  >
                    <p className="whitespace-pre-wrap break-words">{m.text ?? m.kind ?? "—"}</p>
                    <p className="mt-1 text-[10px] opacity-60">
                      {new Date(m.created_at).toLocaleTimeString()}
                    </p>
                  </div>
                ))
              )}
              <div ref={bottom} />
            </div>
            <form
              className="flex gap-2 border-t border-border p-3"
              onSubmit={async (e) => {
                e.preventDefault();
                if (activeChat == null || !draft.trim()) return;
                setBusy(true);
                try {
                  await send({ data: { passcode, chatId: activeChat, text: draft.trim() } });
                  setDraft("");
                  setThread(await messages({ data: { passcode, chatId: activeChat } }));
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Could not send");
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Write a reply…"
                disabled={activeChat == null || busy}
              />
              <Button type="submit" disabled={activeChat == null || busy || !draft.trim()}>
                Send
              </Button>
            </form>
          </div>

          <div className="rounded-xl border border-border bg-surface-2/40 p-4">
            <h2 className="text-sm font-semibold">Broadcast to everyone</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Sends one message to every person who has used the bot.
            </p>
            <Textarea
              className="mt-3"
              rows={3}
              value={announcement}
              onChange={(e) => setAnnouncement(e.target.value)}
              placeholder="New plans are live today 🎉"
            />
            <Button
              className="mt-3"
              variant="secondary"
              disabled={busy || !announcement.trim()}
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await blast({ data: { passcode, text: announcement.trim() } });
                  toast.success(`Sent to ${r.sent} of ${r.total} people`);
                  setAnnouncement("");
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Broadcast failed");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Send broadcast
            </Button>
          </div>
        </section>
      </div>
    </main>
  );
}
