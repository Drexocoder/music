# Aurora Music

Yes. We can build a custom music player/web app that pulls YouTube media.

A good architecture would be:

🎵 Custom Music Player

YouTube search — search songs/videos inside your player

YouTube URL import — paste a YouTube URL and load it

Queue system — add, remove, reorder tracks

Player controls — play/pause, seek, volume, previous/next, shuffle, repeat

Mini-player + full player

Playlists — create, rename, delete and save playlists

Favorites / liked songs

Recently played

Search history

Keyboard controls

Lyrics panel if we have a suitable lyrics source

Visualizer — waveform/equalizer-style animation

Media artwork from available metadata

Responsive desktop/mobile UI

Dark premium UI

Local storage so playlists/settings persist

Important distinction

If by "pull media from YouTube" you mean play YouTube content, we can build around YouTube's supported player/embed mechanisms.

mkae like thiss a msuic player fetches from youttube

## Deploy on Vercel

Aurora uses a Vercel-compatible serverless Telegram webhook. It does not start a
long-running polling process, so it can run alongside the web app on one Vercel
project. The existing `/api/public/telegram/webhook` endpoint handles bot
commands and `/key` generates a Supabase-backed API key for each Telegram user.

1. Import this repository into Vercel and keep the default build command
   `npm run build`.
2. Add the variables in `.env.example` to the Vercel project settings. At
   minimum, configure `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and
   `TELEGRAM_BOT_TOKEN`.
3. After the first deployment, configure Telegram's webhook. Replace the
   placeholders with your deployed domain and token:

```sh
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -d "url=https://<your-domain>/api/public/telegram/webhook" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET_OR_DERIVED_SECRET>"
```

If `TELEGRAM_WEBHOOK_SECRET` is empty, derive the value locally with:

```sh
printf 'telegram-webhook:<TELEGRAM_BOT_TOKEN>' \
  | openssl dgst -sha256 -binary \
  | openssl base64 -A \
  | tr '+/' '-_' \
  | tr -d '='
```

Use the base64url SHA-256 value, not the hexadecimal output, or set an explicit
`TELEGRAM_WEBHOOK_SECRET` to avoid this step. The endpoint rejects requests
without the configured Telegram secret header.

This setup uses the Telegram Bot API directly and is intentionally different
from a Docker/Kurigram polling worker: Vercel functions are short-lived and
cannot keep a Kurigram process alive. If you need Kurigram-specific MTProto
features or polling, run that worker on an always-on Docker host and point it at
the same public API.

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/8c16fde6-9905-42fc-9301-8a808fa7c31d).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
