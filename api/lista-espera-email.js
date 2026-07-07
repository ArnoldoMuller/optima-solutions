// api/lista-espera-email.js
// Endpoint serverless (Vercel) que envia e-mail de confirmação de
// cadastro em lista de espera via Resend, e marca notificacao_enviada=true.
//
// Fluxo:
//  1. Frontend insere no Supabase com tipo_inscricao='lista_espera' (via RLS anon)
//  2. Frontend recebe o id retornado (Prefer: return=representation)
//  3. Frontend chama POST /api/lista-espera-email com { id }
//  4. Este endpoint busca o registro no Supabase (via service_role),
//     valida que é tipo_inscricao='lista_espera' e notificacao_enviada=false,
//     envia o e-mail via Resend e marca a notificação como enviada.
//
// Variáveis de ambiente esperadas no Vercel:
//  - SUPABASE_URL
//  - SUPABASE_SERVICE_KEY
//  - RESEND_API_KEY

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_API_KEY       = process.env.RESEND_API_KEY;

// CORS permissivo — o formulário roda no mesmo domínio, mas mantemos
// para facilitar testes locais.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

module.exports = async (req, res) => {
  // Preflight CORS
  if (req.method === 'OPTIONS') {
    Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(204).end();
  }
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { id } = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    if (!id) return res.status(400).json({ error: 'id obrigatório' });

    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      return res.status(500).json({ error: 'Supabase não configurado' });
    }
    if (!RESEND_API_KEY) {
      return res.status(500).json({ error: 'Resend não configurado' });
    }

    // ── 1. Buscar registro no Supabase ─────────────────────────────────
    const sbGet = await fetch(
      `${SUPABASE_URL}/rest/v1/inscricoes_osteotomia?id=eq.${encodeURIComponent(id)}&select=id,nome,email,tipo_inscricao,notificacao_enviada`,
      {
        headers: {
          'apikey':        SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
        }
      }
    );
    if (!sbGet.ok) {
      const txt = await sbGet.text();
      return res.status(500).json({ error: 'Supabase lookup falhou', detail: txt });
    }
    const rows = await sbGet.json();
    if (!rows.length) return res.status(404).json({ error: 'Inscrição não encontrada' });

    const rec = rows[0];
    if (rec.tipo_inscricao !== 'lista_espera') {
      return res.status(400).json({ error: 'Registro não é de lista de espera' });
    }
    if (rec.notificacao_enviada) {
      // Idempotência — não reenviar
      return res.status(200).json({ status: 'ok', already_sent: true });
    }
    if (!rec.email) {
      return res.status(400).json({ error: 'Registro sem e-mail' });
    }

    // ── 2. Enviar e-mail via Resend ────────────────────────────────────
    const nomeDoc = rec.nome || 'Médico(a)';
    const emailDest = rec.email;

    const resendRes = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type':  'application/json'
      },
      body: JSON.stringify({
        from:    'AOT 2026 <noreply@optimasolutions.com.br>',
        to:      [emailDest],
        subject: '📋 Cadastro em lista de espera recebido — Curso Avançado de Osteotomia 2026',
        html: `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);">

        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#0a2558 0%,#1a3a7a 100%);padding:36px 40px;text-align:center;">
          <p style="color:#c8a84b;font-size:12px;font-weight:700;letter-spacing:3px;text-transform:uppercase;margin:0 0 8px">Optima Solutions</p>
          <h1 style="color:#fff;font-size:26px;font-weight:900;margin:0 0 6px;letter-spacing:1px;">CURSO AVANÇADO DE</h1>
          <h1 style="color:#c8a84b;font-size:30px;font-weight:900;margin:0;letter-spacing:2px;">OSTEOTOMIA 2026</h1>
          <p style="color:rgba(255,255,255,.7);font-size:13px;margin:12px 0 0;">Teoria e Prática · 27–28 de Julho · Hospital Unique · Goiânia</p>
        </td></tr>

        <!-- Confirmação -->
        <tr><td style="padding:40px 40px 24px;text-align:center;">
          <div style="background:#fef7ed;border:2px solid #BA7517;border-radius:12px;padding:20px 24px;margin-bottom:28px;">
            <p style="font-size:28px;margin:0 0 4px;">📋</p>
            <p style="color:#9a5f13;font-size:16px;font-weight:700;margin:0;">Cadastro em lista de espera recebido</p>
          </div>
          <p style="color:#1e293b;font-size:17px;margin:0 0 6px;">Olá, <strong>${nomeDoc}</strong>!</p>
          <p style="color:#475569;font-size:15px;line-height:1.6;margin:0;">
            Obrigado pelo seu interesse no <strong>Curso Avançado de Osteotomia — Teoria e Prática (AOT 2026)</strong>. Recebemos seu cadastro na lista de espera.
          </p>
        </td></tr>

        <!-- Como funciona -->
        <tr><td style="padding:0 40px 24px;">
          <div style="background:#f8fafc;border-radius:12px;padding:20px 24px;border:1px solid #e2e8f0;">
            <p style="font-size:13px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin:0 0 10px;">Como funciona a lista de espera</p>
            <p style="color:#334155;font-size:14px;line-height:1.6;margin:0 0 8px;">As 12 vagas do curso foram preenchidas. Você entrará em uma lista de contatos por ordem de cadastro.</p>
            <p style="color:#334155;font-size:14px;line-height:1.6;margin:0 0 8px;">Caso surja uma vaga por desistência, entraremos em contato por este e-mail com instruções para confirmação da inscrição e pagamento.</p>
            <p style="color:#334155;font-size:14px;line-height:1.6;margin:0;"><strong>Nenhum pagamento é feito neste momento.</strong></p>
          </div>
        </td></tr>

        <!-- Detalhes do evento -->
        <tr><td style="padding:0 40px 32px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
            <tr><td style="padding:16px 20px;border-bottom:1px solid #e2e8f0;">
              <p style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin:0 0 2px;">Data</p>
              <p style="font-size:15px;font-weight:600;color:#0f172a;margin:0;">27 e 28 de Julho de 2026</p>
            </td></tr>
            <tr><td style="padding:16px 20px;border-bottom:1px solid #e2e8f0;">
              <p style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin:0 0 2px;">Local</p>
              <p style="font-size:15px;font-weight:600;color:#0f172a;margin:0;">Hospital Unique · Goiânia – GO</p>
            </td></tr>
            <tr><td style="padding:16px 20px;">
              <p style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin:0 0 2px;">Valor da inscrição</p>
              <p style="font-size:15px;font-weight:600;color:#0f172a;margin:0;">R$ 12.000 · parcelamento em até 6x sem juros via Mercado Pago</p>
            </td></tr>
          </table>
        </td></tr>

        <!-- Encerramento -->
        <tr><td style="padding:0 40px 40px;text-align:center;">
          <p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 20px;">
            Qualquer dúvida, estamos à disposição. Obrigado pelo interesse no curso!
          </p>
          <p style="color:#64748b;font-size:13px;margin:0;">Atenciosamente,</p>
          <p style="color:#0a2558;font-size:15px;font-weight:700;margin:4px 0 0;">Equipe AOT 2026 · Optima Solutions</p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#f8fafc;padding:20px 40px;text-align:center;border-top:1px solid #e2e8f0;">
          <p style="color:#94a3b8;font-size:11px;margin:0;">Este e-mail foi gerado automaticamente. Por favor não responda diretamente.</p>
          <p style="color:#94a3b8;font-size:11px;margin:4px 0 0;">© 2026 Optima Solutions · optimasolutions.com.br</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`
      })
    });

    if (!resendRes.ok) {
      const txt = await resendRes.text();
      console.error('Resend error:', txt);
      return res.status(500).json({ error: 'Falha ao enviar e-mail', detail: txt });
    }

    // ── 3. Marcar notificação como enviada ─────────────────────────────
    await fetch(
      `${SUPABASE_URL}/rest/v1/inscricoes_osteotomia?id=eq.${encodeURIComponent(id)}`,
      {
        method:  'PATCH',
        headers: {
          'apikey':        SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type':  'application/json',
          'Prefer':        'return=minimal'
        },
        body: JSON.stringify({ notificacao_enviada: true })
      }
    ).catch(err => console.error('Supabase PATCH error:', err.message));

    return res.status(200).json({ status: 'ok', sent_to: emailDest });

  } catch (err) {
    console.error('lista-espera-email error:', err);
    return res.status(500).json({ error: 'Erro interno', detail: err.message });
  }
};
