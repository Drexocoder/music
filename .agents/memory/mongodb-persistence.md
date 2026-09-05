---
name: MongoDB persistence
description: Database choice and Atlas constraints for the Telegram/API persistence layer.
---

The Telegram/API persistence layer uses MongoDB through the server-only `MONGODB_URI` secret. The URI database name is used unless `MONGODB_DB_NAME` is set.

**Why:** Supabase credentials were unavailable, while the selected Atlas cluster is already at its 500-collection limit; eager collection/index creation caused startup failures.

**How to apply:** Keep Mongo initialization lazy and avoid automatic collection creation or index migrations unless the target Atlas cluster has collection capacity. Rotate any URI exposed in chat before storing it.