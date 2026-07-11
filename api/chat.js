// api/chat.js
// Função serverless (Vercel) — Assistente Optima (chat com IA no site).
//
// Fluxo:
//  1. Recebe { sessionId, messages } do widget (assets/chat-widget.js)
//  2. Valida o payload (tamanho do histórico e das mensagens)
//  3. Chama a API da Anthropic com a personalidade de api/_assistant-prompt.js
//  4. Grava a conversa na tabela conversas_chat do projeto Supabase
//     "optima-clinical" (best-effort — nunca bloqueia a resposta ao usuário)
//  5. Devolve { reply }
//
// Variáveis de ambiente esperadas no Vercel:
//  - ANTHROPIC_API_KEY
//  - SUPABASE_URL                (projeto optima-clinical)
//  - SUPABASE_SERVICE_ROLE_KEY   (service_role do projeto optima-clinical)

import { SYSTEM_PROMPT } from './_assistant-prompt.js';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const MAX_MESSAGES = 30;
const MAX_MESSAGE_LENGTH = 1500;

const ALLOWED_ORIGINS = [
  'https://optimasolutions.com.br',
  'https://www.optimasolutions.com.br'
];

const FALLBACK_REPLY =
  'Desculpe, tive uma instabilidade aqui. O senhor pode tentar novamente ou, se preferir, falar direto com o Arnoldo no WhatsApp: https://wa.me/5585933008206';

function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
}

function isValidPayload(body) {
  if (!body || typeof body !== 'object') return false;
  if (typeof body.sessionId !== 'string' || !body.sessionId) return false;
  if (!Array.isArray(body.messages) || body.messages.length === 0) return false;
  if (body.messages.length > MAX_MESSAGES) return false;

  for (const msg of body.messages) {
    if (!msg || typeof msg !== 'object') return false;
    if (msg.role !== 'user' && msg.role !== 'assistant') return false;
    if (typeof msg.content !== 'string' || !msg.content) return false;
    if (msg.content.length > MAX_MESSAGE_LENGTH) return false;
  }

  return true;
}

async function saveConversation(sessionId, userMessage, assistantReply, pagina) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;

  try {
    await fetch(`${SUPABASE_URL}/rest/v1/conversas_chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        Prefer: 'return=minimal'
      },
      body: JSON.stringify([
        { session_id: sessionId, role: 'user', content: userMessage, pagina },
        { session_id: sessionId, role: 'assistant', content: assistantReply, pagina }
      ])
    });
  } catch (err) {
    console.error('[chat] Supabase save error:', err.message);
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

  if (!isValidPayload(body)) {
    return res.status(400).json({
      error: `Payload inválido: máximo de ${MAX_MESSAGES} mensagens no histórico e ${MAX_MESSAGE_LENGTH} caracteres por mensagem.`
    });
  }

  const { sessionId, messages } = body;

  if (!ANTHROPIC_API_KEY) {
    console.error('[chat] ANTHROPIC_API_KEY não configurado');
    return res.status(200).json({ reply: FALLBACK_REPLY });
  }

  let reply;

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 600,
        system: SYSTEM_PROMPT,
        messages: messages.map((m) => ({ role: m.role, content: m.content }))
      })
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error('[chat] Anthropic API error:', anthropicRes.status, errText);
      reply = FALLBACK_REPLY;
    } else {
      const data = await anthropicRes.json();
      const textBlock = (data.content || []).find((b) => b.type === 'text');
      reply = textBlock && textBlock.text ? textBlock.text : FALLBACK_REPLY;
    }
  } catch (err) {
    console.error('[chat] Anthropic API request failed:', err.message);
    reply = FALLBACK_REPLY;
  }

  const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
  const pagina = req.headers.referer || req.headers.referrer || null;

  // Gravação no Supabase é best-effort e não pode bloquear a resposta.
  saveConversation(sessionId, lastUserMessage ? lastUserMessage.content : '', reply, pagina).catch(() => {});

  return res.status(200).json({ reply });
}
