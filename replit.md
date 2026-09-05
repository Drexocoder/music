# Aurora Music on Replit

The `Start application` workflow runs both services:

- TanStack/Vite web app on port 5000
- Python yt-dlp downloader on private port 8080

Vite proxies `/api/download/*` and `/health` to the downloader, matching the
same public paths routed to the downloader container by `vercel.json`.

Required runtime tools are Python 3.12, `yt-dlp`, and `ffmpeg`. MongoDB,
Telegram, and YouTube API credentials are only required for their corresponding
features; the downloader itself does not require them.

Run the project with:

```sh
npm run dev:replit -- --host 0.0.0.0 --port 5000
```