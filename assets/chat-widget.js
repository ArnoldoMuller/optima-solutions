/* assets/chat-widget.js
   Assistente Optima — widget de chat com IA (JavaScript puro, sem dependências).
   Injeta o botão flutuante e a janela de conversa no final do <body>. */
(function () {
  'use strict';

  var WELCOME_MESSAGE =
    'Olá! Sou o assistente virtual da Optima Solutions. Posso ajudar o senhor com informações sobre o Synolis V-A, o Tropocells PRP e o nosso suporte ao médico. Com quem tenho o prazer de falar?';
  var MAX_MESSAGE_LENGTH = 1500;
  var SESSION_STORAGE_KEY = 'optima_chat_session_id';
  var API_ENDPOINT = '/api/chat';

  var history = []; // { role: 'user' | 'assistant', content: string }
  var sending = false;
  var opened = false;
  var welcomed = false;

  function getSessionId() {
    var id = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(SESSION_STORAGE_KEY, id);
    }
    return id;
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Converte texto simples em HTML seguro, transformando URLs (inclusive
  // wa.me) em links clicáveis que abrem em nova aba. Nunca injeta HTML
  // bruto vindo da resposta do modelo.
  function renderMessageHtml(text) {
    var escaped = escapeHtml(text);
    var urlPattern = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g;
    return escaped.replace(urlPattern, function (url) {
      return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + '</a>';
    });
  }

  function buildDom() {
    var launcher = document.createElement('button');
    launcher.className = 'optima-chat-widget-launcher';
    launcher.setAttribute('aria-label', 'Abrir chat do Assistente Optima');
    launcher.setAttribute('data-open', 'false');
    launcher.innerHTML =
      '<span class="optima-chat-widget-badge"></span>' +
      '<svg class="optima-chat-widget-icon-open" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>' +
      '</svg>' +
      '<svg class="optima-chat-widget-icon-close" viewBox="0 0 24 24" stroke="#C8A84B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>' +
      '</svg>';

    var panel = document.createElement('div');
    panel.className = 'optima-chat-widget-panel';
    panel.setAttribute('data-open', 'false');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Assistente Optima');
    panel.innerHTML =
      '<div class="optima-chat-widget-header">' +
      '  <div>' +
      '    <p class="optima-chat-widget-header-title">Assistente Optima</p>' +
      '    <p class="optima-chat-widget-header-subtitle">Optima Solutions · Atendimento</p>' +
      '  </div>' +
      '  <button type="button" class="optima-chat-widget-header-close" aria-label="Fechar chat">' +
      '    <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>' +
      '  </button>' +
      '</div>' +
      '<div class="optima-chat-widget-body" role="log" aria-live="polite"></div>' +
      '<div class="optima-chat-widget-inputbar">' +
      '  <textarea class="optima-chat-widget-textarea" rows="1" maxlength="' + MAX_MESSAGE_LENGTH + '" placeholder="Escreva sua mensagem..." aria-label="Mensagem"></textarea>' +
      '  <button type="button" class="optima-chat-widget-send" aria-label="Enviar mensagem">' +
      '    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M2 21l21-9L2 3v7l15 2-15 2z"></path></svg>' +
      '  </button>' +
      '</div>' +
      '<div class="optima-chat-widget-footer">' +
      '  <span>Assistente virtual · Para atendimento direto, <a href="https://wa.me/5585933008206" target="_blank" rel="noopener noreferrer">WhatsApp (85) 93300-8206</a></span>' +
      '</div>';

    document.body.appendChild(launcher);
    document.body.appendChild(panel);

    return { launcher: launcher, panel: panel };
  }

  function scrollToBottom(body) {
    body.scrollTop = body.scrollHeight;
  }

  function appendMessage(body, role, text) {
    var el = document.createElement('div');
    el.className =
      'optima-chat-widget-msg ' +
      (role === 'user' ? 'optima-chat-widget-msg-user' : 'optima-chat-widget-msg-assistant');
    el.innerHTML = renderMessageHtml(text);
    body.appendChild(el);
    scrollToBottom(body);
    return el;
  }

  function showTyping(body) {
    var el = document.createElement('div');
    el.className = 'optima-chat-widget-typing';
    el.setAttribute('data-typing-indicator', 'true');
    el.innerHTML = '<span></span><span></span><span></span>';
    body.appendChild(el);
    scrollToBottom(body);
    return el;
  }

  async function sendMessage(refs, text) {
    var trimmed = text.trim();
    if (!trimmed || sending) return;
    if (trimmed.length > MAX_MESSAGE_LENGTH) {
      trimmed = trimmed.slice(0, MAX_MESSAGE_LENGTH);
    }

    sending = true;
    refs.sendBtn.disabled = true;
    refs.textarea.value = '';
    refs.textarea.style.height = 'auto';

    appendMessage(refs.body, 'user', trimmed);
    history.push({ role: 'user', content: trimmed });

    var typingEl = showTyping(refs.body);

    try {
      var res = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: getSessionId(),
          messages: history.slice(-30)
        })
      });

      var data = await res.json();
      var reply =
        data && typeof data.reply === 'string'
          ? data.reply
          : 'Desculpe, tive uma instabilidade aqui. O senhor pode tentar novamente ou, se preferir, falar direto com o Arnoldo no WhatsApp: https://wa.me/5585933008206';

      typingEl.remove();
      appendMessage(refs.body, 'assistant', reply);
      history.push({ role: 'assistant', content: reply });
    } catch (err) {
      typingEl.remove();
      var fallback =
        'Desculpe, tive uma instabilidade aqui. O senhor pode tentar novamente ou, se preferir, falar direto com o Arnoldo no WhatsApp: https://wa.me/5585933008206';
      appendMessage(refs.body, 'assistant', fallback);
      history.push({ role: 'assistant', content: fallback });
    } finally {
      sending = false;
      refs.sendBtn.disabled = false;
      refs.textarea.focus();
    }
  }

  function openPanel(refs) {
    opened = true;
    document.body.classList.add('optima-chat-open');
    refs.launcher.setAttribute('data-open', 'true');
    refs.panel.setAttribute('data-open', 'true');
    refs.launcher.setAttribute('aria-label', 'Fechar chat do Assistente Optima');

    if (!welcomed) {
      welcomed = true;
      appendMessage(refs.body, 'assistant', WELCOME_MESSAGE);
      history.push({ role: 'assistant', content: WELCOME_MESSAGE });
    }

    setTimeout(function () {
      refs.textarea.focus();
    }, 150);
  }

  function closePanel(refs) {
    opened = false;
    document.body.classList.remove('optima-chat-open');
    refs.launcher.setAttribute('data-open', 'false');
    refs.panel.setAttribute('data-open', 'false');
    refs.launcher.setAttribute('aria-label', 'Abrir chat do Assistente Optima');
  }

  function init() {
    var dom = buildDom();
    var refs = {
      launcher: dom.launcher,
      panel: dom.panel,
      body: dom.panel.querySelector('.optima-chat-widget-body'),
      textarea: dom.panel.querySelector('.optima-chat-widget-textarea'),
      sendBtn: dom.panel.querySelector('.optima-chat-widget-send'),
      closeBtn: dom.panel.querySelector('.optima-chat-widget-header-close')
    };

    refs.launcher.addEventListener('click', function () {
      if (opened) {
        closePanel(refs);
      } else {
        openPanel(refs);
      }
    });

    refs.closeBtn.addEventListener('click', function () {
      closePanel(refs);
    });

    refs.sendBtn.addEventListener('click', function () {
      sendMessage(refs, refs.textarea.value);
    });

    refs.textarea.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage(refs, refs.textarea.value);
      }
    });

    refs.textarea.addEventListener('input', function () {
      refs.textarea.style.height = 'auto';
      refs.textarea.style.height = Math.min(refs.textarea.scrollHeight, 90) + 'px';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
