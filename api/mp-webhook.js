// api/mp-webhook.js — Vercel Serverless Function
// Recebe notificações do Mercado Pago, salva no Supabase,
// registra taxas no Fluxo de Caixa e dispara e-mail de confirmação

const SUPABASE_URL     = 'https://gbgfqjuazcwqjgwgqjaw.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const MP_ACCESS_TOKEN  = process.env.MP_ACCESS_TOKEN;
const RESEND_API_KEY   = process.env.RESEND_API_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body      = req.body || {};
    const type      = body.type || body.action?.split('.')?.[0];
    const paymentId = body.data?.id;

    if (type !== 'payment') {
      return res.status(200).json({ ok: true, skipped: true, reason: 'not a payment' });
    }
    if (!paymentId) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'no payment id' });
    }
    if (paymentId === '123456' || String(paymentId).length < 8) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'test notification' });
    }

    // ── 1. Busca detalhes do pagamento no MP ──────────────────────────────
    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` }
    });
    if (!mpRes.ok) {
      const errText = await mpRes.text();
      console.error('MP API error:', mpRes.status, errText);
      return res.status(200).json({ ok: false, reason: 'mp_api_error', status: mpRes.status });
    }
    const payment = await mpRes.json();

    if (!['approved', 'pending', 'in_process'].includes(payment.status)) {
      return res.status(200).json({ ok: true, skipped: true, status: payment.status });
    }

    const meta         = payment.metadata || {};
    const valorBruto   = payment.transaction_amount || 0;

    // ── 2. Calcula taxas do Mercado Pago ─────────────────────────────────
    // fee_details: array com objetos { type: 'mercadopago_fee', amount: X }
    const fees         = payment.fee_details || [];
    const taxaMP       = fees.filter(f => f.type === 'mercadopago_fee').reduce((s,f) => s + (f.amount||0), 0);
    const taxaParc     = fees.filter(f => f.type === 'financing_fee').reduce((s,f) => s + (f.amount||0), 0);
    const totalTaxas   = taxaMP + taxaParc;
    const valorLiquido = payment.net_received_amount || (valorBruto - totalTaxas);
    const dataHoje     = new Date().toISOString().split('T')[0];

    const sbHeaders = {
      'Content-Type':  'application/json',
      'apikey':        SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Prefer':        'resolution=merge-duplicates,return=minimal'
    };

    // ── 3. Salva / atualiza inscrição ─────────────────────────────────────
    const sbRes = await fetch(`${SUPABASE_URL}/rest/v1/inscricoes_osteotomia`, {
      method:  'POST',
      headers: sbHeaders,
      body: JSON.stringify({
        mp_payment_id:          String(payment.id),
        mp_external_reference:  payment.external_reference,
        mp_status:              payment.status,
        mp_status_detail:       payment.status_detail,
        mp_payment_type:        payment.payment_type_id,
        valor_pago:             valorBruto,
        nome:                   meta.nome          || payment.payer?.first_name || '',
        crm:                    meta.crm           || '',
        especialidade:          meta.especialidade || '',
        email:                  meta.email         || payment.payer?.email || '',
        celular:                meta.celular       || '',
        endereco:               meta.endereco      || '',
        cidade:                 meta.cidade        || '',
        uf:                     meta.uf            || '',
        scrub:                  meta.scrub         || '',
        restricao_alimentar:    meta.restricao     || '',
        restricao_detalhe:      meta.restricao_detalhe || ''
      })
    });
    if (!sbRes.ok) {
      const err = await sbRes.text();
      console.error('Supabase inscricao error:', err);
      return res.status(200).json({ ok: false, reason: 'supabase_insc_error' });
    }

    // ── 4. Registra taxas no Fluxo de Caixa (só aprovados) ───────────────
    if (payment.status === 'approved' && totalTaxas > 0) {
      const refName = meta.nome ? `Inscrição ${meta.nome}` : `Pagamento ${paymentId}`;

      const lancamentos = [];

      // Taxa por venda (2,99%)
      if (taxaMP > 0) {
        lancamentos.push({
          tipo:            'despesa',
          categoria:       'Taxas MP',
          descricao:       `Taxa MP — ${refName}`,
          valor:           parseFloat(taxaMP.toFixed(2)),
          status:          'realizado',
          origem:          'inscricao',
          patrocinador:    '',
          observacoes:     `Taxa por venda (2,99%) — Pag ID ${paymentId}`,
          data_lancamento: dataHoje
        });
      }

      // Taxa de parcelamento
      if (taxaParc > 0) {
        lancamentos.push({
          tipo:            'despesa',
          categoria:       'Taxas MP',
          descricao:       `Taxa parcelamento — ${refName}`,
          valor:           parseFloat(taxaParc.toFixed(2)),
          status:          'realizado',
          origem:          'inscricao',
          patrocinador:    '',
          observacoes:     `Taxa de parcelamento — Pag ID ${paymentId}`,
          data_lancamento: dataHoje
        });
      }

      for (const lanc of lancamentos) {
        const fRes = await fetch(`${SUPABASE_URL}/rest/v1/fluxo_caixa_osteotomia`, {
          method:  'POST',
          headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
          body:    JSON.stringify(lanc)
        });
        if (!fRes.ok) {
          console.error('Supabase fluxo error:', await fRes.text());
        }
      }

      console.log(`Taxas registradas: MP R$${taxaMP.toFixed(2)}, Parc R$${taxaParc.toFixed(2)}`);
    }

    // ── 5. Dispara e-mail de confirmação (só aprovados, só se tiver e-mail) ─
    if (payment.status === 'approved' && (meta.email || payment.payer?.email) && RESEND_API_KEY) {
      const emailDest = meta.email || payment.payer?.email;
      const nomeDoc   = meta.nome || 'Médico(a)';
      const valorFmt  = valorBruto.toLocaleString('pt-BR', { minimumFractionDigits: 2 });

      await fetch('https://api.resend.com/emails', {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type':  'application/json'
        },
        body: JSON.stringify({
          from:    'AOT 2026 <noreply@optimasolutions.com.br>',
          to:      [emailDest],
          subject: '✅ Inscrição confirmada — Curso Avançado de Osteotomia 2026',
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
          <div style="background:#f0fdf4;border:2px solid #16a34a;border-radius:12px;padding:20px 24px;margin-bottom:28px;">
            <p style="font-size:28px;margin:0 0 4px;">✅</p>
            <p style="color:#15803d;font-size:16px;font-weight:700;margin:0;">Inscrição Confirmada!</p>
          </div>
          <p style="color:#1e293b;font-size:17px;margin:0 0 6px;">Olá, <strong>${nomeDoc}</strong>!</p>
          <p style="color:#475569;font-size:15px;line-height:1.6;margin:0;">
            É com grande satisfação que confirmamos sua inscrição no <strong>Curso Avançado de Osteotomia — Teoria e Prática</strong>. Estamos muito felizes em ter você conosco nessa jornada de aprendizado e aperfeiçoamento técnico.
          </p>
        </td></tr>

        <!-- Detalhes -->
        <tr><td style="padding:0 40px 32px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
            <tr><td style="padding:16px 20px;border-bottom:1px solid #e2e8f0;">
              <p style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin:0 0 2px;">Participante</p>
              <p style="font-size:15px;font-weight:600;color:#0f172a;margin:0;">${nomeDoc}</p>
            </td></tr>
            <tr><td style="padding:16px 20px;border-bottom:1px solid #e2e8f0;">
              <p style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin:0 0 2px;">Data & Local</p>
              <p style="font-size:15px;font-weight:600;color:#0f172a;margin:0;">27 e 28 de Julho de 2026 · Hospital Unique, Goiânia – GO</p>
            </td></tr>
            <tr><td style="padding:16px 20px;border-bottom:1px solid #e2e8f0;">
              <p style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin:0 0 2px;">Valor Pago</p>
              <p style="font-size:15px;font-weight:700;color:#15803d;margin:0;">R$ ${valorFmt}</p>
            </td></tr>
            <tr><td style="padding:16px 20px;">
              <p style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin:0 0 2px;">ID da Transação</p>
              <p style="font-size:13px;color:#64748b;margin:0;font-family:monospace;">${paymentId}</p>
            </td></tr>
          </table>
        </td></tr>

        <!-- Incluído -->
        <tr><td style="padding:0 40px 32px;">
          <p style="font-size:13px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px;">Incluído na sua inscrição</p>
          <table width="100%" cellpadding="0" cellspacing="0">
            ${['2 dias de curso teórico e prático','Material didático exclusivo','Scrub cirúrgico personalizado','Coffee breaks e refeições','Certificado de participação','Happy hour de encerramento'].map(item=>`
            <tr><td style="padding:6px 0;border-bottom:1px solid #f1f5f9;">
              <span style="color:#16a34a;margin-right:8px;">✓</span>
              <span style="color:#374151;font-size:14px;">${item}</span>
            </td></tr>`).join('')}
          </table>
        </td></tr>

        <!-- CTA -->
        <tr><td style="padding:0 40px 40px;text-align:center;">
          <p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 20px;">
            Em breve entraremos em contato com informações detalhadas sobre o programa, local e orientações para o evento. Qualquer dúvida, estamos à disposição.
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
      }).catch(err => console.error('Resend error:', err.message));

      console.log('E-mail de confirmação enviado para:', emailDest);
    }

    console.log('Webhook processado:', paymentId, payment.status);
    return res.status(200).json({ ok: true, payment_id: paymentId, status: payment.status });

  } catch (error) {
    console.error('Webhook error:', error.message);
    return res.status(200).json({ ok: false, error: error.message });
  }
}
