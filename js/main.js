/* ==========================================================================
   Barquin — JS mínimo (sem biblioteca)
   1) Carrossel de avaliações: scroll-snap nativo + botões scrollBy
   2) Medição: carregamento assíncrono na visita + clique em WhatsApp
   3) Painel de privacidade
   Nenhuma função aqui bloqueia a navegação: os <a href="wa.me/..."> funcionam
   sem JS. Se a medição falhar, os botões continuam funcionando.
   ========================================================================== */
(function () {
  'use strict';

  /* ---------------------------------------------------------------------
     1) CONFIGURAÇÃO DE MEDIÇÃO — PREENCHER COM OS IDs REAIS
     ---------------------------------------------------------------------
     Não há IDs ficticios neste arquivo. Enquanto os campos abaixo forem
     null, nenhuma tag é carregada e nenhum evento é enviado.
     Consent Mode v2 é montado com tudo negado ANTES de qualquer tag.
     O clique em WhatsApp é registrado como MICROCONVERSÃO DE INTENÇÃO
     DE CONTATO — não comprova conversa nem contratação.
  */
  var MEDICAO = {
    ga4Id: null,          // ex.: 'G-XXXXXXXXXX'  (obrigatório para enable)
    adsId: null,          // ex.: 'AW-XXXXXXXXX'
    linkedInId: null,     // opcional, não usado nesta campanha
    consentMode: true,    // Consent Mode v2 com default negado
    // Ao existir um CMP real, chame: window.barquinConsent.grant() / .deny()
  };

  var gtagReady = false;
  window.dataLayer = window.dataLayer || [];

  function gtag() { window.dataLayer.push(arguments); }

  function consentPadrao() {
    if (!MEDICAO.consentMode || typeof gtag !== 'function') return;
    gtag('consent', 'default', {
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
      analytics_storage: 'denied',
      functionality_storage: 'granted',
      security_storage: 'granted',
      wait_for_update: 500
    });
  }

  /* API para o CMP real (banner de cookies) conceder ou negar. */
  window.barquinConsent = {
    grant: function () {
      if (!MEDICAO.consentMode) return;
      gtag('consent', 'update', {
        ad_storage: 'granted',
        ad_user_data: 'granted',
        ad_personalization: 'granted',
        analytics_storage: 'granted'
      });
      carregarTag();
    },
    deny: function () {
      if (!MEDICAO.consentMode) return;
      gtag('consent', 'update', {
        ad_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied',
        analytics_storage: 'denied'
      });
    }
  };

  /* Carregamento ASSÍNCRONO já na primeira visita (não adiado até o 1º clique),
     para preservar a atribuição do clique do Google Ads. */
  function carregarTag() {
    if (gtagReady || !MEDICAO.ga4Id) return;
    gtagReady = true;
    window.gtag = gtag;
    gtag('js', new Date());
    gtag('config', MEDICAO.ga4Id, { send_page_view: true });
    if (MEDICAO.adsId) gtag('config', MEDICAO.adsId, { send_page_view: false });
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(MEDICAO.ga4Id);
    /* onerror NÃO zera gtagReady: os eventos ficam enfileirados no dataLayer e
       saem assim que a biblioteca carregar (ou por GTM no servidor). Zerar aqui
       perderia justamente o clique de conversão. A pagina segue funcionando. */
    s.onerror = function () { /* silencioso: ver comentário acima */ };
    document.head.appendChild(s);
  }

  function iniciarMedicao() {
    consentPadrao();
    /* Sem CMP configurado, o default negado permanece: nada é enviado.
       Quando o consentimento for registrado, barquinConsent.grant() libera. */
    if (MEDICAO.ga4Id && !MEDICAO.consentMode) carregarTag();
  }

  /* Clique em WhatsApp = intenção de contato (microconversão), por posição. */
  document.addEventListener('click', function (ev) {
    var a = ev.target.closest && ev.target.closest('a[data-wa]');
    if (!a) return;
    /* não usa preventDefault: a navegação para o wa.me acontece sempre */
    if (!gtagReady) return;
    gtag('event', 'whatsapp_click', {
      event_category: 'contato',
      event_label: a.getAttribute('data-wa-pos') || a.getAttribute('data-wa') || 'desconhecido',
      cta_group: a.getAttribute('data-wa') || '',
      /* nome padronizado para virar conversão no Google Ads */
      conversion_name: 'whatsapp_intencao_contato',
      value: 1,
      currency: 'BRL'
    });
  }, { passive: true });

  /* ---------------------------------------------------------------------
     2) CARROSSEL DE AVALIAÇÕES
     Um cartão por vista no celular, três lado a lado no desktop.
     Rolagem nativa (scroll-snap), sem autoplay. Teclado: a track tem
     tabindex=0 e os botões são <button>, então tudo é acessível por teclado.
  */
  function passoDoTrack(track) {
    var item = track.firstElementChild;
    if (!item) return track.clientWidth;
    var estilo = getComputedStyle(track);
    var gap = parseFloat(estilo.columnGap || estilo.gap || '0') || 0;
    return item.getBoundingClientRect().width + gap;
  }

  function iniciarCarrossel() {
    var raiz = document.querySelector('[data-carrossel]');
    if (!raiz) return;
    var track = raiz.querySelector('[data-carrossel-track]');
    var prev = raiz.querySelector('[data-carrossel-prev]');
    var next = raiz.querySelector('[data-carrossel-next]');
    var status = raiz.querySelector('[data-carrossel-status]');
    if (!track) return;

    var itens = track.children;
    /* Sem avaliações transcritas, a seção fica no estado de aviso honesto.
       Os listeners sao SEMPRE ligados: assim o carrossel funciona se os
       cards forem inseridos depois (ex.: via CMS) sem recarregar o JS. */
    raiz.hidden = itens.length === 0;

    function visiveis() {
      var w = window.matchMedia('(min-width: 900px)').matches ? 3
            : window.matchMedia('(min-width: 600px)').matches ? 2 : 1;
      return Math.max(1, Math.min(w, itens.length));
    }

    function indice() {
      var p = passoDoTrack(track);
      if (!p) return 0;
      return Math.round(track.scrollLeft / p);
    }

    function maximo() { return Math.max(0, itens.length - visiveis()); }

    function atualizar() {
      if (itens.length === 0) {
        if (prev) prev.disabled = true;
        if (next) next.disabled = true;
        if (status) status.textContent = '';
        return;
      }
      var i = indice(), m = maximo();
      i = Math.max(0, Math.min(m, i));
      if (prev) prev.disabled = track.scrollLeft <= 2;
      if (next) next.disabled = track.scrollLeft >= track.scrollWidth - track.clientWidth - 2;
      if (status) {
        var fim = Math.min(itens.length, i + visiveis());
        status.textContent = (i + 1) + '–' + fim + ' de ' + itens.length;
      }
    }

    /* Alvo acumulado: cliques rapidos durante a animacao suave SOMAM, em vez
       de cada um recalcular a partir do scrollLeft ainda parado no inicio. */
    var alvo = null;
    var fimScroll = null;

    function onScroll() {
      atualizar();
      if (alvo === null) return;
      clearTimeout(fimScroll);
      fimScroll = setTimeout(function () {
        if (Math.abs(track.scrollLeft - alvo * passoDoTrack(track)) <= 2) alvo = null;
      }, 140);
    }

    function ir(delta) {
      var m = maximo();
      if (alvo === null) alvo = indice();
      alvo = Math.max(0, Math.min(m, alvo + delta));
      track.scrollTo({ left: alvo * passoDoTrack(track), behavior: prefersReduce() ? 'auto' : 'smooth' });
    }

    if (prev) prev.addEventListener('click', function () { ir(-1); });
    if (next) next.addEventListener('click', function () { ir(1); });
    track.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', function () { alvo = null; atualizar(); });
    /* se os cards forem inseridos depois (CMS), revela e reindexa */
    if (window.MutationObserver) {
      new MutationObserver(function () {
        raiz.hidden = itens.length === 0;
        atualizar();
      }).observe(track, { childList: true });
    }
    atualizar();
  }

  function prefersReduce() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /* ---------------------------------------------------------------------
     3) PAINEL DE PRIVACIDADE
  */
  function iniciarPrivacidade() {
    var btn = document.querySelector('[data-priv]');
    var painel = document.querySelector('[data-priv-panel]');
    if (!btn || !painel) return;
    btn.addEventListener('click', function () {
      var aberto = !painel.hidden;
      painel.hidden = aberto;
      btn.setAttribute('aria-expanded', String(!aberto));
    });
  }

  function init() {
    try { iniciarMedicao(); } catch (e) { /* medição nunca quebra a página */ }
    try { iniciarCarrossel(); } catch (e) { /* idem */ }
    try { iniciarPrivacidade(); } catch (e) { /* idem */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
