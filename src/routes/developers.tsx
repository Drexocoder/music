import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/developers")({
  head: () => ({
    meta: [
      { title: "Aurora Music API — free keys for search & downloads" },
      {
        name: "description",
        content:
          "Generate a free Aurora Music API key from Telegram and use it to search YouTube music and fetch audio or video files.",
      },
      { property: "og:title", content: "Aurora Music API — free keys for search & downloads" },
      {
        property: "og:description",
        content:
          "Generate a free Aurora Music API key from Telegram and use it to search YouTube music and fetch audio or video files.",
      },
    ],
  }),
  component: Developers,
});

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-xl border border-border bg-surface-2/60 p-4 text-xs leading-relaxed text-foreground">
      <code>{children}</code>
    </pre>
  );
}

function Developers() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-14">
      <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
        ← Back to the player
      </Link>

      <h1 className="mt-6 text-3xl font-semibold tracking-tight">Aurora Music API</h1>
      <p className="mt-3 text-muted-foreground">
        Search music and fetch audio or video files from your own apps. Every account gets one free
        key each month.
      </p>

      <section className="mt-10 space-y-3">
        <h2 className="text-xl font-semibold">1. Get your key</h2>
        <p className="text-sm text-muted-foreground">
          Open the Telegram bot and send <code>/key</code>. It replies with your key, your limits
          and the expiry date. <code>/usage</code> shows what you have left, <code>/revoke</code>{" "}
          cancels it.
        </p>
      </section>

      <section className="mt-10 space-y-3">
        <h2 className="text-xl font-semibold">2. Search</h2>
        <Code>{`GET /api/public/v1/search?q=blinding%20lights&api_key=YOUR_KEY

{
  "ok": true,
  "results": [
    { "id": "4NRXx6U8ABQ", "title": "…", "channel": "…", "thumbnail": "…", "duration": "3:22" }
  ],
  "usage": { "today": 1, "month": 1 }
}`}</Code>
      </section>

      <section className="mt-10 space-y-3">
        <h2 className="text-xl font-semibold">3. Download</h2>
        <p className="text-sm text-muted-foreground">
          Returns the file itself, so you can stream it straight to disk.
        </p>
        <Code>{`GET /api/public/v1/download?url=4NRXx6U8ABQ&type=audio&api_key=YOUR_KEY

curl -L -o song.mp3 \\
  "https://your-domain/api/public/v1/download?url=https://youtu.be/4NRXx6U8ABQ&type=audio&api_key=YOUR_KEY"`}</Code>
        <p className="text-sm text-muted-foreground">
          <code>type</code> accepts <code>audio</code> (mp3) or <code>video</code> (mp4).{" "}
          <code>url</code> accepts a full YouTube link or a plain video id.
        </p>
      </section>

      <section className="mt-10 space-y-3">
        <h2 className="text-xl font-semibold">4. Check your quota</h2>
        <Code>{`GET /api/public/v1/status?api_key=YOUR_KEY`}</Code>
      </section>

      <section className="mt-10 space-y-2">
        <h2 className="text-xl font-semibold">Errors</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>
            <b>401</b> — the key is missing, unknown or revoked.
          </li>
          <li>
            <b>429</b> — daily or monthly limit reached.
          </li>
          <li>
            <b>502 / 503</b> — the media service is busy or not configured.
          </li>
        </ul>
      </section>
    </main>
  );
}
