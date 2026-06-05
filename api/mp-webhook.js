// api/mp-webhook.js — Vercel Serverless Function
// Recebe notificações do Mercado Pago e salva no Supabase

const SUPABASE_URL = 'https://gbgfqjuazcwqjgwgqjaw.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

export default async function handler(req, res) {
  // Aceita apenas POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { type, data } = req.body;

    // Só processa notificações de pagamento
    if (type !== 'payment') {
      return res.status(200).json({ ok: true, skipped: true });
    }

    const paymentId = data?.id;
    if (!paymentId) {
      return res.status(400).json({ error: 'Missing payment id' });
    }

    // Busca detalhes do pagamento na API do Mercado Pago
    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` }
    });

    if (!mpRes.ok) {
      throw new Error(`MP API error: ${mpRes.status}`);
    }

    const payment = await mpRes.json();

    // Só salva pagamentos aprovados ou pendentes
    if (!['approved', 'pending', 'in_process'].includes(payment.status)) {
      return res.status(200).json({ ok: true, status: payment.status, skipped: true });
    }

    const meta = payment.metadata || {};

    // Salva no Supabase
    const sbRes = await fetch(`${SUPABASE_URL}/rest/v1/inscricoes_osteotomia`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Prefer': 'resolution=merge-duplicates'
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
      throw new Error(`Supabase error: ${err}`);
    }

    return res.status(200).json({ ok: true, payment_id: paymentId, status: payment.status });

  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({ error: error.message });
  }
}
