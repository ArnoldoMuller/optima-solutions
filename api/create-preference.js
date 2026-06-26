// api/create-preference.js
// Função serverless Vercel — o MP_ACCESS_TOKEN fica em variável de ambiente,
// nunca exposto no HTML/browser.

export default async function handler(req, res) {
  // Só aceita POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'MP_ACCESS_TOKEN não configurado' });
  }

  try {
    const body = req.body; // { price, nome, email, crm, especialidade, endereco, cidade, uf, scrub, restricao, restricao_detalhe }

    const preference = {
      items: [{
        title: `Curso Avançado de Osteotomia — Teoria e Prática (${body.priceLabel || 'Inscrição'})`,
        description: '27–28 de Julho de 2026 · Hospital Unique · Goiânia, GO',
        quantity: 1,
        unit_price: Number(body.price),
        currency_id: 'BRL'
      }],
      payer: {
        name: body.nome,
        email: body.email
      },
      payment_methods: {
        installments: 10,           // máximo de 10x
        default_installments: 1,
        // Parcelas sem juros: 1x, 2x e 3x — acima disso os juros são do comprador
        // O MP aplica juros automaticamente nas parcelas acima deste número
        installments_without_fees: 3
      },
      back_urls: {
        success: 'https://www.optimasolutions.com.br/osteotomia/confirmacao',
        failure: 'https://www.optimasolutions.com.br/osteotomia/erro',
        pending: 'https://www.optimasolutions.com.br/osteotomia/pendente'
      },
      auto_return: 'approved',
      external_reference: `OSTEO-${Date.now()}`,
      metadata: {
        nome:              body.nome,
        crm:               body.crm,
        especialidade:     body.especialidade,
        email:             body.email,
        endereco:          body.endereco,
        cidade:            body.cidade,
        uf:                body.uf,
        scrub:             body.scrub,
        restricao:         body.restricao,
        restricao_detalhe: body.restricao_detalhe || ''
      }
    };

    const mpRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(preference)
    });

    if (!mpRes.ok) {
      const err = await mpRes.text();
      return res.status(mpRes.status).json({ error: err });
    }

    const data = await mpRes.json();

    // Devolve apenas o init_point — o browser não precisa de mais nada
    return res.status(200).json({ init_point: data.init_point });

  } catch (err) {
    console.error('[create-preference]', err);
    return res.status(500).json({ error: 'Erro interno' });
  }
}
