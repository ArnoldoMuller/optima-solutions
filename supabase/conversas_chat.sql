-- supabase/conversas_chat.sql
-- Execute no SQL Editor do projeto Supabase "optima-clinical" (não é o
-- projeto próprio do site Optima Solutions). Cria uma tabela isolada para
-- gravar as conversas do Assistente Optima, sem tocar nas tabelas
-- existentes (ex.: usuarios_restrito).

create table if not exists public.conversas_chat (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  role text not null check (role in ('user','assistant')),
  content text not null,
  pagina text,
  created_at timestamptz not null default now()
);

create index if not exists idx_conversas_chat_session on public.conversas_chat (session_id, created_at);

alter table public.conversas_chat enable row level security;
-- Sem policies públicas: apenas a service_role (usada pela função serverless) grava e lê.
