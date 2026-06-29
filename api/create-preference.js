// api/create-preference.js
// Função serverless Vercel
// 1. Salva dados do formulário no Supabase (antes do pagamento)
// 2. Cria preferência no Mercado Pago
// 3. Devolve init_point para o browser redirecionar
//
// IMPORTANTE: salvar antes garante que mesmo se o webhook falhar ou
// o metadata do MP não chegar, os dados do participante já estão no banco.

const SUPABASE_URL         = 'https://gbgfqjuazcwqjgwgqjaw.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'MP_ACCESS_TOKEN não configurado' });
  }
  if (!SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'SUPABASE_SERVICE_KEY não configurado' });
  }

  try {
    const body = req.body;

    // ── 1. Gera external_reference único ─────────────────────────────────
    const externalRef = `OSTEO-${Date.now()}`;

    // ── 2. Salva inscrição no Supabase com status 'pending' ───────────────
    //    Usa external_reference como chave única.
    //    Quando o webhook chegar, fará UPSERT atualizando o status.
    const sbPayload = {
      mp_external_reference: externalRef,
      mp_status:             'pending',
      valor_pago:            Number(body.price),
      nome:                  body.nome          || '',
      crm:                   body.crm           || '',
      especialidade:         body.especialidade || '',
      email:                 body.email         || '',
      celular:               body.celular       || '',
      endereco:              body.endereco      || '',
      cidade:                body.cidade        || '',
      uf:                    body.uf            || '',
      scrub:                 body.scrub         || '',
      restricao_alimentar:   body.restricao     || '',
      restricao_detalhe:     body.restricao_detalhe || '',
      tipo_inscricao:        'pagante'
    };

    const sbRes = await fetch(`${SUPABASE_URL}/rest/v1/inscricoes_osteotomia`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Prefer':        'return=minimal'
      },
      body: JSON.stringify(sbPayload)
    });

    if (!sbRes.ok) {
      const err = await sbRes.text();
      console.error('[create-preference] Supabase pre-save error:', err);
      // Não bloqueia o fluxo — segue para criar a preferência no MP
      // mas loga para investigação
    } else {
      console.log('[create-preference] Inscrição pré-salva no Supabase:', externalRef);
    }

    // ── 3. Cria preferência no Mercado Pago ───────────────────────────────
    const preference = {
      items: [{
        title:       `Curso Avançado de Osteotomia — Teoria e Prática (${body.priceLabel || 'Inscrição'})`,
        description: '27–28 de Julho de 2026 · Hospital Unique · Goiânia, GO',
        quantity:    1,
        unit_price:  Number(body.price),
        currency_id: 'BRL'
      }],
      payer: {
        name:  body.nome,
        email: body.email
      },
      payment_methods: {
        installments:         body.installmentMode === 'with_fees' ? 10 : 6,
        default_installments: 1
      },
      back_urls: {
        success: 'https://www.optimasolutions.com.br/osteotomia/confirmacao',
        failure: 'https://www.optimasolutions.com.br/osteotomia/erro',
        pending: 'https://www.optimasolutions.com.br/osteotomia/pendente'
      },
      auto_return:        'approved',
      external_reference: externalRef,
      // metadata ainda enviado como fallback (MP pode ou não propagar)
      metadata: {
        nome:              body.nome,
        crm:               body.crm,
        especialidade:     body.especialidade,
        email:             body.email,
        celular:           body.celular       || '',
        endereco:          body.endereco,
        cidade:            body.cidade,
        uf:                body.uf,
        scrub:             body.scrub,
        restricao:         body.restricao,
        restricao_detalhe: body.restricao_detalhe || ''
      }
    };

    const mpRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(preference)
    });

    if (!mpRes.ok) {
      const err = await mpRes.text();
      return res.status(mpRes.status).json({ error: err });
    }

    const data = await mpRes.json();
    return res.status(200).json({ init_point: data.init_point });

  } catch (err) {
    console.error('[create-preference]', err);
    return res.status(500).json({ error: 'Erro interno' });
  }
}
