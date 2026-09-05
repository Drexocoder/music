CREATE TABLE public.telegram_messages (
  id uuid primary key default gen_random_uuid(),
  update_id bigint unique,
  chat_id bigint not null,
  telegram_user_id bigint,
  username text,
  first_name text,
  direction text not null check (direction in ('in','out')),
  text text,
  kind text,
  created_at timestamptz not null default now()
);
CREATE INDEX idx_tg_msgs_chat ON public.telegram_messages (chat_id, created_at desc);
CREATE INDEX idx_tg_msgs_created ON public.telegram_messages (created_at desc);
GRANT ALL ON public.telegram_messages TO service_role;
ALTER TABLE public.telegram_messages ENABLE ROW LEVEL SECURITY;