-- supabase/cadastros.sql
-- Execute no SQL Editor do projeto Supabase "optima-clinical" (o mesmo banco
-- usado pela tabela conversas_chat do Assistente Optima — não altere essa
-- tabela). Cria a tabela isolada que recebe os envios de /cadastro.

create table if not exists public.cadastros (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('empresa','pessoa')),
  -- comuns
  nome text,                 -- nome fantasia (empresa) ou nome completo (pessoa)
  razao_social text,
  documento text,            -- CNPJ (empresa) ou CPF (pessoa)
  especialidade text,
  nome_doutor text,
  empresa_clinica text,
  cargo text,
  departamento text,
  telefone text,
  telefone_tipo text,
  email text,
  -- endereço
  cep text,
  numero text,
  endereco text,
  complemento text,
  bairro text,
  cidade text,
  uf text,
  pais text,
  observacoes text,
  -- meta
  origem text default 'site-cadastro',
  created_at timestamptz not null default now()
);

create index if not exists idx_cadastros_created on public.cadastros (created_at desc);

alter table public.cadastros enable row level security;
-- Sem policies públicas: apenas a service_role (função serverless) grava.
