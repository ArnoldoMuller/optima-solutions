// api/mp-webhook.js — Vercel Serverless Function
// Recebe notificações do Mercado Pago e salva no Supabase

const SUPABASE_URL = 'https://gbgfqjuazcwqjgwgqjaw.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body || {};
    const type = body.type || body.action?.split('.')?.[0];
    const paymentId = body.data?.id;

    // Ignora notificações que não são de pagamento
    if (type !== 'payment') {
      return res.status(200).json({ ok: true, skipped: true, reason: 'not a payment' });
    }

    if (!paymentId) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'no payment id' });
    }

    // Ignora IDs claramente fictícios (testes do painel MP)
    if (paymentId === '123456' || String(paymentId).length < 8) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'test notification' });
    }

    // Busca detalhes do pagamento na API do Mercado Pago
    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` }
    });

    if (!mpRes.ok) {
      const errText = await mpRes.text();
      console.error('MP API error:', mpRes.status, errText);
      // Retorna 200 para o MP não reenviar indefinidamente
      return res.status(200).json({ ok: false, reason: 'mp_api_error', status: mpRes.status });
    }

    const payment = await mpRes.json();

    // Só salva pagamentos relevantes
    if (!['approved', 'pending', 'in_process'].includes(payment.status)) {
      return res.status(200).json({ ok: true, skipped: true, status: payment.status });
    }

    const meta = payment.metadata || {};

    // Salva no Supabase
    const sbRes = await fetch(`${SUPABASE_URL}/rest/v1/inscricoes_osteotomia`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Prefer': 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify({
        mp_payment_id:        String(payment.id),
        mp_external_reference: payment.external_reference,
        mp_status:            payment.status,
        mp_status_detail:     payment.status_detail,
        mp_payment_type:      payment.payment_type_id,
        valor_pago:           payment.transaction_amount,
        nome:                 meta.nome || payment.payer?.first_name || '',
        crm:                  meta.crm || '',
        especialidade:        meta.especialidade || '',
        email:                meta.email || payment.payer?.email || '',
        endereco:             meta.endereco || '',
        cidade:               meta.cidade || '',
        uf:                   meta.uf || '',
        scrub:                meta.scrub || '',
        restricao_alimentar:  meta.restricao || '',
        restricao_detalhe:    meta.restricao_detalhe || ''
      })
    });

    if (!sbRes.ok) {
      const err = await sbRes.text();
      console.error('Supabase error:', err);
      return res.status(200).json({ ok: false, reason: 'supabase_error' });
    }

    console.log('Inscrição salva:', paymentId, payment.status);
    return res.status(200).json({ ok: true, payment_id: paymentId, status: payment.status });

  } catch (error) {
    console.error('Webhook error:', error.message);
    // Sempre retorna 200 para o MP não reenviar
    return res.status(200).json({ ok: false, error: error.message });
  }
}
