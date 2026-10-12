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
     1) MEDIÇÃO — CONFIGURAÇÃO
     ---------------------------------------------------------------------
     O Consent Mode v2 (default negado + reaplicação da escolha salva) vive
     em um UNICO bloco inline no <head>, ANTES do GTM, que expõe
     window.barquinConsent. Este arquivo NÃO define consentimento: apenas
     conduz a interface e grava a escolha do visitante em localStorage.
     Enquanto os IDs forem null, nada é carregado daqui — as tags do Google
     vivem no GTM e respeitam o estado definido no <head>.
     O clique em WhatsApp é registrado como MICROCONVERSÃO DE INTENÇÃO DE
     CONTATO — não comprova conversa nem contratação.
  */
  var MEDICAO = {
    ga4Id: null,          // ex.: 'G-XXXXXXXXXX'  (obrigatório para enable)
    adsId: null,          // ex.: 'AW-XXXXXXXXX'
    linkedInId: null,     // opcional, não usado nesta campanha
    consentMode: true,    // Consent Mode v2 gerenciado pelo bloco do <head>
  };

  var gtag = window.gtag;
  var gtagReady = false;

  function podeEnviar() { return typeof gtag === 'function'; }

  /* Fallback de carregamento direto de GA4/Ads. Fica INATIVO enquanto
     consentMode for true (padrão): as tags do Google vivem no GTM. */
  function carregarTag() {
    if (gtagReady || !podeEnviar() || !MEDICAO.ga4Id) return;
    gtagReady = true;
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
    /* O consentimento é definido no <head> (window.barquinConsent). Sem IDs
       preenchidos, nada é carregado daqui. */
    if (MEDICAO.ga4Id && !MEDICAO.consentMode) carregarTag();
  }

  /* Clique em WhatsApp = intenção de contato (microconversão), por posição. */
  document.addEventListener('click', function (ev) {
    var a = ev.target.closest && ev.target.closest('a[data-wa]');
    if (!a) return;
    /* não usa preventDefault: a navegação para o wa.me acontece sempre */
    if (!gtagReady || !podeEnviar()) return;
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
     2) PREFERÊNCIAS DE COOKIES (interface do Consent Mode v2)
     O estado de consentimento é definido e reaplicado pelo bloco inline do
     <head> (window.barquinConsent). Aqui só conduzimos a interface: mostrar
     na primeira visita, aplicar a escolha e permitir alterá-la depois.
  */
  function iniciarConsentimento() {
    var caixa = document.querySelector('[data-consent]');
    var api = window.barquinConsent;
    if (!caixa || !api) return;

    var detalhes = caixa.querySelector('[data-consent-details]');
    var btnAceitar = caixa.querySelector('[data-consent-accept]');
    var btnRecusar = caixa.querySelector('[data-consent-reject]');
    var btnPers = caixa.querySelector('[data-consent-customize]');
    var btnSalvar = caixa.querySelector('[data-consent-save]');
    var chkAna = caixa.querySelector('[data-consent-cat="analytics"]');
    var chkAds = caixa.querySelector('[data-consent-cat="ads"]');
    var btnAbrir = document.querySelector('[data-consent-open]');

    function refletir() {
      var p = api.read() || { analytics: false, ads: false };
      if (chkAna) chkAna.checked = p.analytics === true;
      if (chkAds) chkAds.checked = p.ads === true;
    }

    function abrir(focar) {
      refletir();
      caixa.hidden = false;
      if (focar && btnPers) btnPers.focus();
    }

    function fechar() {
      caixa.hidden = true;
      if (detalhes) detalhes.hidden = true;
      if (btnPers) btnPers.setAttribute('aria-expanded', 'false');
    }

    if (btnAceitar) btnAceitar.addEventListener('click', function () { api.acceptAll(); fechar(); });
    if (btnRecusar) btnRecusar.addEventListener('click', function () { api.rejectAll(); fechar(); });
    if (btnSalvar) btnSalvar.addEventListener('click', function () {
      api.set({ analytics: !!(chkAna && chkAna.checked), ads: !!(chkAds && chkAds.checked) });
      fechar();
    });
    if (btnPers && detalhes) btnPers.addEventListener('click', function () {
      detalhes.hidden = !detalhes.hidden;
      btnPers.setAttribute('aria-expanded', String(!detalhes.hidden));
      if (!detalhes.hidden && chkAna) chkAna.focus();
    });
    if (btnAbrir) btnAbrir.addEventListener('click', function () { abrir(true); });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !caixa.hidden) fechar();
    });

    if (api.read()) { fechar(); } else { abrir(false); }
  }

  /* ---------------------------------------------------------------------
     3) CARROSSEL DE AVALIAÇÕES
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
     4) PAINEL DE PRIVACIDADE (informativo, no rodapé)
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
    try { iniciarConsentimento(); } catch (e) { /* idem */ }
    try { iniciarCarrossel(); } catch (e) { /* idem */ }
    try { iniciarPrivacidade(); } catch (e) { /* idem */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
