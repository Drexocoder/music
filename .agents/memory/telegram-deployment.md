---
name: Telegram deployment
description: Architecture decision for hosting the Telegram bot with this music web app.
---

Vercel hosts the web app and Telegram webhook through the direct Telegram Bot API. A Kurigram polling or MTProto worker must run separately on an always-on host.

**Why:** Vercel functions are short-lived and can be frozen immediately after returning a response, so they cannot reliably keep a Kurigram polling process alive.

**How to apply:** Keep key generation and API calls in the shared server-side code. Use Telegram `setWebhook` for the Vercel deployment; only add a Docker/Kurigram worker when MTProto or polling-specific features are required.