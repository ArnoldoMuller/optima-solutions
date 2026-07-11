// api/cadastro.js
// Função serverless (Vercel) — recebe o formulário de cadastro de cliente
// (cadastro.html), grava no Supabase (projeto optima-clinical, tabela
// `cadastros`) e notifica o Arnoldo por e-mail via Resend.
//
// Nunca perder o lead: banco e e-mail são tentados de forma independente
// (best-effort) — só respondemos erro ao visitante se AMBOS falharem.
//
// Variáveis de ambiente esperadas no Vercel:
//  - SUPABASE_URL                (projeto optima-clinical)
//  - SUPABASE_SERVICE_ROLE_KEY   (service_role do projeto optima-clinical)
//  - RESEND_API_KEY

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;

const NOTIFICATION_EMAIL = 'arnoldo.muller@optimasolutions.com.br';

// Outras funções deste repositório (api/lista-espera-email.js, api/mp-webhook.js)
// já enviam com sucesso a partir de "@optimasolutions.com.br", o que indica que
// o domínio está verificado no Resend. Mantemos como remetente principal e, se
// o envio falhar (ex.: domínio deixou de estar verificado), caímos para o
// remetente sandbox do Resend para não perder a notificação.
const FROM_PRIMARY = 'Optima Solutions <cadastro@optimasolutions.com.br>';
const FROM_FALLBACK = 'Optima Solutions <onboarding@resend.dev>';

const ALLOWED_ORIGINS = [
  'https://optimasolutions.com.br',
  'https://www.optimasolutions.com.br'
];

const ESPECIALIDADES = [
  'Ortopedia', 'Fisioterapia', 'Medicina Estética', 'Reumatologia',
  'Clínica Geral', 'Oncologia', 'Geriatria', 'Outro'
];
const CARGOS = [
  'Médico(a)', 'Fisioterapeuta', 'Gerente Administrativo', 'Comprador(a)',
  'Recepcionista', 'Sócio/Proprietário', 'Outro'
];

const REQUIRED_FIELDS = {
  empresa: ['documento', 'nome', 'razao_social', 'especialidade', 'cep', 'numero', 'bairro', 'uf', 'email'],
  pessoa: ['documento', 'nome', 'especialidade', 'cargo', 'cep', 'numero', 'bairro', 'uf', 'email']
};

const FIELD_LABELS = {
  documento: 'CNPJ/CPF',
  nome: 'Nome',
  razao_social: 'Razão Social',
  especialidade: 'Especialidade',
  cargo: 'Cargo',
  cep: 'CEP',
  numero: 'Número',
  bairro: 'Bairro',
  uf: 'Estado (UF)',
  email: 'E-mail'
};

function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
}

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function validatePayload(body) {
  if (!body || typeof body !== 'object') return 'Payload inválido.';
  if (body.tipo !== 'empresa' && body.tipo !== 'pessoa') return 'Tipo de cadastro inválido.';

  const missing = REQUIRED_FIELDS[body.tipo].filter((field) => {
    const value = body[field];
    return typeof value !== 'string' || !value.trim();
  });
  if (missing.length > 0) {
    return `Campos obrigatórios não preenchidos: ${missing.map((f) => FIELD_LABELS[f] || f).join(', ')}.`;
  }
  if (!isValidEmail(body.email)) return 'E-mail inválido.';
  if (body.tipo === 'empresa' && !ESPECIALIDADES.includes(body.especialidade)) return 'Especialidade inválida.';
  if (body.tipo === 'pessoa' && !CARGOS.includes(body.cargo)) return 'Cargo inválido.';

  return null;
}

function buildRecord(body) {
  return {
    tipo: body.tipo,
    nome: (body.nome || '').trim(),
    razao_social: (body.razao_social || '').trim() || null,
    documento: (body.documento || '').trim(),
    especialidade: (body.especialidade || '').trim(),
    nome_doutor: (body.nome_doutor || '').trim() || null,
    empresa_clinica: (body.empresa_clinica || '').trim() || null,
    cargo: (body.cargo || '').trim() || null,
    departamento: (body.departamento || '').trim() || null,
    telefone: (body.telefone || '').trim() || null,
    telefone_tipo: (body.telefone_tipo || '').trim() || null,
    email: (body.email || '').trim(),
    cep: (body.cep || '').trim(),
    numero: (body.numero || '').trim(),
    endereco: (body.endereco || '').trim() || null,
    complemento: (body.complemento || '').trim() || null,
    bairro: (body.bairro || '').trim(),
    cidade: (body.cidade || '').trim() || null,
    uf: (body.uf || '').trim(),
    pais: (body.pais || '').trim() || null,
    observacoes: (body.observacoes || '').trim() || null,
    origem: 'site-cadastro'
  };
}

async function saveToSupabase(record) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[cadastro] Supabase não configurado');
    return false;
  }
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/cadastros`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        Prefer: 'return=minimal'
      },
      body: JSON.stringify(record)
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error('[cadastro] Supabase insert error:', res.status, errText);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[cadastro] Supabase insert failed:', err.message);
    return false;
  }
}

function buildEmailHtml(record) {
  const rows = [
    ['Tipo', record.tipo === 'empresa' ? 'Pessoa Jurídica (Empresa)' : 'Pessoa Física'],
    ['Nome', record.nome],
    ['Razão Social', record.razao_social],
    ['CNPJ/CPF', record.documento],
    ['Especialidade', record.especialidade],
    ['Nome do Doutor', record.nome_doutor],
    ['Empresa/Clínica', record.empresa_clinica],
    ['Cargo', record.cargo],
    ['Departamento', record.departamento],
    ['Telefone', record.telefone ? `${record.telefone} (${record.telefone_tipo || 'não informado'})` : null],
    ['E-mail', record.email],
    ['CEP', record.cep],
    ['Endereço', [record.endereco, record.numero, record.complemento].filter(Boolean).join(', ')],
    ['Bairro', record.bairro],
    ['Cidade/UF', [record.cidade, record.uf].filter(Boolean).join(' / ')],
    ['País', record.pais],
    ['Observações', record.observacoes]
  ].filter(([, value]) => value);

  const rowsHtml = rows
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding:10px 16px;border-bottom:1px solid #e2e8f0;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap;">${label}</td>
          <td style="padding:10px 16px;border-bottom:1px solid #e2e8f0;font-size:14px;color:#0f172a;">${String(value).replace(/</g, '&lt;')}</td>
        </tr>`
    )
    .join('');

  const pfNote =
    record.tipo === 'pessoa'
      ? `<tr><td colspan="2" style="padding:16px;background:#fef7ed;border-top:2px solid #C8A84B;font-size:13px;color:#9a5f13;">📋 Cadastro PF — lembrar de cobrar o envio da foto do CRM e do comprovante de residência, se ainda não recebidos.</td></tr>`
      : '';

  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);">
        <tr><td style="background:linear-gradient(135deg,#1C3461 0%,#13244A 100%);padding:28px 32px;">
          <p style="color:#C8A84B;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin:0 0 6px">Optima Solutions</p>
          <h1 style="color:#fff;font-size:20px;font-weight:800;margin:0;">Novo cadastro recebido</h1>
        </td></tr>
        <tr><td>
          <table width="100%" cellpadding="0" cellspacing="0">
            ${rowsHtml}
            ${pfNote}
          </table>
        </td></tr>
        <tr><td style="padding:18px 32px;text-align:center;background:#f8fafc;border-top:1px solid #e2e8f0;">
          <p style="color:#94a3b8;font-size:11px;margin:0;">Enviado automaticamente pelo formulário em optimasolutions.com.br/cadastro</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function sendResendEmail(from, subject, html) {
  return fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ from, to: [NOTIFICATION_EMAIL], subject, html })
  });
}

async function sendNotificationEmail(record) {
  if (!RESEND_API_KEY) {
    console.error('[cadastro] RESEND_API_KEY não configurado');
    return false;
  }

  const subject = `Novo cadastro Optima — ${record.nome} (${record.tipo})`;
  const html = buildEmailHtml(record);

  try {
    let res = await sendResendEmail(FROM_PRIMARY, subject, html);
    if (!res.ok) {
      const errText = await res.text();
      console.error('[cadastro] Resend error com remetente principal, tentando fallback:', res.status, errText);
      res = await sendResendEmail(FROM_FALLBACK, subject, html);
      if (!res.ok) {
        const fallbackErr = await res.text();
        console.error('[cadastro] Resend error com remetente fallback:', res.status, fallbackErr);
        return false;
      }
    }
    return true;
  } catch (err) {
    console.error('[cadastro] Resend request failed:', err.message);
    return false;
  }
}

export default async function handler(req, res) {
  setCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

  const validationError = validatePayload(body);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const record = buildRecord(body);

  const [savedToDb, emailSent] = await Promise.all([saveToSupabase(record), sendNotificationEmail(record)]);

  if (!savedToDb) console.error('[cadastro] Falha ao gravar no Supabase:', record.email);
  if (!emailSent) console.error('[cadastro] Falha ao enviar e-mail de notificação:', record.email);

  if (!savedToDb && !emailSent) {
    return res.status(500).json({ error: 'Não foi possível processar o cadastro no momento.' });
  }

  return res.status(200).json({ ok: true });
}
