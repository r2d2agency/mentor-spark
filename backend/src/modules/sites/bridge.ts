/**
 * Bridge entre a página HTML do mentor (dentro do iframe sandboxed) e a
 * plataforma (o app React, que é o "pai").
 *
 * Contrato de marcação no HTML do mentor:
 *   <button data-mf="checkout">Comprar</button>
 *   <button data-mf="signup">Quero me cadastrar</button>
 *   <form data-mf="signup">
 *     <input data-mf-field="name" name="name" required>
 *     <input data-mf-field="email" name="email" type="email" required>
 *   </form>
 *   <button data-mf="event">Garantir vaga</button>
 *   <a data-mf="link" data-mf-href="/programa">Programa</a>
 *
 * Protocolo (postMessage):
 *   iframe -> pai: { type: 'mf:hello' } | { type:'mf:checkout' } | { type:'mf:signup', requestId, fields }
 *              | { type:'mf:signup-open' } | { type:'mf:event', fields } | { type:'mf:link', href }
 *   pai -> iframe: { type:'mf:init', nonce } | { type:'mf:open-checkout' } | { type:'mf:submit-signup-result', ok, message }
 *              | { type:'mf:navigate', href } | { type:'mf:error', message }
 *
 * O iframe roda com `sandbox` SEM `allow-same-origin` → a origem é opaca
 * (`event.origin === "null"`). Portanto:
 *   - não é possível validar a origem por string; o pai valida `event.source`;
 *   - `postMessage` para o iframe precisa de targetOrigin `'*'` (o browser
 *     descarta mensagens enviadas para uma origem específica quando o
 *     documento é opaco);
 *   - por isso o canal pai->iframe é autenticado por um **nonce** gerado pelo
 *     pai no handshake, e nenhum PII trafega antes do handshake.
 */

export interface BridgeConfig {
  siteToken: string;
  mentorSlug: string;
  pageSlug: string;
  apiBase: string;
  successType: 'internal' | 'url' | 'file';
  successFile: string | null;
  eventSlug: string | null;
}

export const BRIDGE_VERSION = 1;

/** Escapa uma string para embutir com segurança em JS inline. */
function jsString(value: string): string {
  return JSON.stringify(String(value ?? '').replace(/<\//g, '<\\/'));
}

export function renderBridgeScript(cfg: BridgeConfig): string {
  const config = {
    version: BRIDGE_VERSION,
    siteToken: cfg.siteToken,
    mentorSlug: cfg.mentorSlug,
    pageSlug: cfg.pageSlug,
    apiBase: cfg.apiBase,
    successType: cfg.successType,
    successFile: cfg.successFile,
    eventSlug: cfg.eventSlug,
  };

  return `(function () {
  var CFG = JSON.parse(${jsString(JSON.stringify(config))});
  var nonce = null;
  var ready = false;

  function post(msg) {
    try { window.parent.postMessage(msg, '*'); } catch (e) {}
  }

  function fail(message) {
    var box = document.createElement('div');
    box.setAttribute('data-mf-error', '1');
    box.textContent = message;
    box.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;padding:12px 16px;background:#7f1d1d;color:#fff;font:14px/1.4 system-ui,sans-serif;text-align:center';
    document.body && document.body.appendChild(box);
  }

  // ---- extração de campos do formulário ----
  function guessField(input) {
    var el = input;
    var explicit = el.getAttribute && el.getAttribute('data-mf-field');
    if (explicit) return explicit;
    var keys = [el.getAttribute && el.getAttribute('name'), el.getAttribute && el.getAttribute('id'), el.getAttribute && el.getAttribute('placeholder')];
    var hay = keys.filter(Boolean).join(' ').toLowerCase();
    var type = (el.getAttribute && el.getAttribute('type')) || '';
    if (type === 'email' || hay.indexOf('email') >= 0 || hay.indexOf('e-mail') >= 0) return 'email';
    if (type === 'tel' || hay.indexOf('phone') >= 0 || hay.indexOf('telefone') >= 0 || hay.indexOf('whatsapp') >= 0) return 'phone';
    if (hay.indexOf('cpf') >= 0 || hay.indexOf('cnpj') >= 0 || hay.indexOf('documento') >= 0) return 'cpfCnpj';
    if (hay.indexOf('empresa') >= 0 || hay.indexOf('company') >= 0) return 'company';
    if (hay.indexOf('receita') >= 0 || hay.indexOf('revenue') >= 0 || hay.indexOf('faturamento') >= 0) return 'revenue';
    if (hay.indexOf('nome') >= 0 || hay.indexOf('name') >= 0 || hay.indexOf('fullname') >= 0) return 'name';
    return '';
  }

  function collectFields(form) {
    var out = {};
    var nodes = form ? form.querySelectorAll('input, select, textarea') : [];
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var key = guessField(el);
      if (!key) continue;
      if (el.type === 'checkbox' || el.type === 'radio') {
        if (el.checked) out[key] = el.value || 'true';
      } else {
        out[key] = (el.value || '').trim();
      }
    }
    return out;
  }

  function requestId() {
    try {
      if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    } catch (e) {}
    return 'mf-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  // ---- delegação de eventos (fase capture: roda antes dos handlers do mentor) ----
  function onClick(ev) {
    var el = ev.target && ev.target.closest ? ev.target.closest('[data-mf]') : null;
    if (!el) return;
    var action = el.getAttribute('data-mf');
    if (!action) return;

    if (action === 'checkout') {
      ev.preventDefault();
      ev.stopPropagation();
      post({ type: 'mf:checkout' });
      return;
    }
    if (action === 'signup') {
      // Se o marcador está num form, o submit cuida. Aqui é botão/link solto.
      var form = el.closest('form');
      if (form) return;
      ev.preventDefault();
      ev.stopPropagation();
      post({ type: 'mf:signup-open' });
      return;
    }
    if (action === 'event') {
      ev.preventDefault();
      ev.stopPropagation();
      post({ type: 'mf:event', fields: collectFields(el.closest('form')) });
      return;
    }
    if (action === 'link') {
      var href = el.getAttribute('data-mf-href') || el.getAttribute('href') || '';
      if (!href) return;
      ev.preventDefault();
      ev.stopPropagation();
      post({ type: 'mf:link', href: href });
    }
  }

  function onSubmit(ev) {
    var form = ev.target;
    if (!form || !form.getAttribute) return;
    if (form.getAttribute('data-mf') !== 'signup') return;
    ev.preventDefault();
    ev.stopPropagation();
    post({ type: 'mf:signup', requestId: requestId(), fields: collectFields(form) });
  }

  document.addEventListener('click', onClick, true);
  document.addEventListener('submit', onSubmit, true);

  // ---- handshake ----
  window.addEventListener('message', function (ev) {
    var msg = ev.data;
    if (!msg || typeof msg !== 'object') return;
    // O pai responde ao hello com o nonce. Só o pai que handshakeou fala.
    if (msg.type === 'mf:init') {
      nonce = msg.nonce || null;
      ready = !!nonce;
      post({ type: 'mf:ready' });
      return;
    }
    if (!ready || !nonce) return;
    if (msg.nonce !== nonce) return;

    if (msg.type === 'mf:navigate' && msg.href) {
      try { window.location.href = msg.href; } catch (e) {}
      return;
    }
    if (msg.type === 'mf:submit-signup-result') {
      var form = document.querySelector('[data-mf] form, form[data-mf]');
      var target = form || document.body;
      if (!target) return;
      var box = target.querySelector('[data-mf-result]');
      if (!box) {
        box = document.createElement('div');
        box.setAttribute('data-mf-result', '1');
        target.appendChild(box);
      }
      box.textContent = msg.message || (msg.ok ? 'Tudo certo!' : 'Não foi possível concluir.');
      box.setAttribute('data-mf-status', msg.ok ? 'ok' : 'error');
      if (msg.ok && msg.href) {
        try { window.location.href = msg.href; } catch (e) {}
      }
      return;
    }
    if (msg.type === 'mf:error') {
      fail(msg.message || 'Não foi possível concluir.');
    }
  });

  post({ type: 'mf:hello', version: CFG.version });
  window.setTimeout(function () {
    if (!ready) fail('Não foi possível conectar à plataforma. Recarregue a página.');
  }, 2500);
})();`;
}
