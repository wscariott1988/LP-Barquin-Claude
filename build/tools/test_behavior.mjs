/* Testes de comportamento: sem JavaScript, medicao e web vitals.
   uso: node build/tools/test_behavior.mjs */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const SHOTS = join(ROOT, 'build', 'screenshots');
// Chrome resolvido em vez de fixo (ver comentario em test_layout.mjs).
const CANDIDATOS = [
  process.env.CHROME_PATH,
  join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean);
const CHROME = CANDIDATOS.find((p) => existsSync(p));
if (!CHROME) {
  console.error('Chrome nao encontrado.\n'
    + 'Instale o Google Chrome ou aponte CHROME_PATH para o executavel, por exemplo:\n'
    + '  $env:CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"\n'
    + 'Procurado em:\n  ' + CANDIDATOS.join('\n  '));
  process.exit(1);
}
const URL_ = 'http://127.0.0.1:8765/';
const PORT = 9334;
if (!existsSync(SHOTS)) mkdirSync(SHOTS, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'barquin-cdp2-'));

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-sandbox',
  '--no-first-run', '--disable-extensions', '--mute-audio',
  '--disable-background-networking', '--disable-sync',
  '--force-device-scale-factor=1', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function wsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch { /* subindo */ }
    await sleep(250);
  }
  throw new Error('Chrome nao subiu');
}
class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pend = new Map(); this.ev = [];
    ws.addEventListener('message', (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && this.pend.has(msg.id)) {
        const { res, rej } = this.pend.get(msg.id);
        this.pend.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      } else if (msg.method) this.ev.push(msg);
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const p = { id, method, params };
    if (sessionId) p.sessionId = sessionId;
    this.ws.send(JSON.stringify(p));
    return new Promise((res, rej) => {
      this.pend.set(id, { res, rej });
      setTimeout(() => { if (this.pend.has(id)) { this.pend.delete(id); rej(new Error('timeout ' + method)); } }, 30000);
    });
  }
}
async function ev(cdp, sid, expr) {
  const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid);
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result.value;
}
async function ir(cdp, sid, w, h, mobile) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile, screenWidth: w, screenHeight: h }, sid);
  await cdp.send('Page.navigate', { url: URL_ }, sid);
  await sleep(1600);
}
const falhas = [];
const T = (n, ok, d) => {
  console.log(`  ${ok ? 'ok   ' : 'FALHA'} ${n}${d ? '  [' + d + ']' : ''}`);
  if (!ok) falhas.push(n + ' :: ' + d);
};

const sock = new WebSocket(await wsUrl());
await new Promise((res, rej) => { sock.addEventListener('open', res); sock.addEventListener('error', rej); });
const cdp = new CDP(sock);

/* ===================================================================== */
/* 1) SEM JAVASCRIPT: o CSS via <noscript> tem de segurar a pagina        */
/* ===================================================================== */
console.log('\n=== 1) SEM JAVASCRIPT (noscript) ===');
{
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: sid } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, sid);
  await cdp.send('Emulation.setScriptExecutionDisabled', { value: true }, sid);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true }, sid);
  await cdp.send('Page.navigate', { url: URL_ }, sid);
  await sleep(1800);

  // com JS desativado nao ha Runtime; religamos o JS so para MEDIR o
  // resultado do renderBlocked, que e o que importa aqui.
  await cdp.send('Emulation.setScriptExecutionDisabled', { value: false }, sid);
  const r = await ev(cdp, sid, `(() => {
    const sheets = [...document.styleSheets].map((s) => (s.href || 'inline').split('/').pop());
    const linkCss = [...document.querySelectorAll('link[rel=stylesheet],link[rel=preload][as=style]')].map((l) => l.getAttribute('href'));
    const hero = getComputedStyle(document.querySelector('.hero')).backgroundColor;
    const sticky = getComputedStyle(document.querySelector('.sticky')).display;
    const cardPad = getComputedStyle(document.querySelector('.card')).padding;
    const nav = getComputedStyle(document.querySelector('.site-nav')).display;
    const stickyCta = document.querySelector('.sticky__btn').getBoundingClientRect();
    const heroCta = document.querySelector('.hero__cta .btn').getBoundingClientRect();
    return { sheets, linkCss, mobileCards: getComputedStyle(document.querySelector('.cards')).gridTemplateColumns,
             hero, sticky, cardPad, nav, ctaSticky: stickyCta.height, ctaHero: heroCta.height,
             altura: document.documentElement.scrollHeight };
  })()`);
  // agora mede o grid do desktop na MESMA pagina renderizada sem script
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sid);
  await sleep(500);
  const rDesk = await ev(cdp, sid, `(() => ({
    grid3: getComputedStyle(document.querySelector('.grid3')).gridTemplateColumns,
    cards: getComputedStyle(document.querySelector('.cards')).gridTemplateColumns,
    sticky: getComputedStyle(document.querySelector('.sticky')).display,
    nav: getComputedStyle(document.querySelector('.site-nav')).display,
    ctaSm: document.querySelector('.site-nav .btn').getBoundingClientRect().height,
  }))()`);
  console.log('  folhas de estilo:', r.sheets.join(' | '));
  console.log('  links de CSS:', r.linkCss.join(' | '));
  console.log('  1440px: .grid3 =', rDesk.grid3, '| .cards =', rDesk.cards, '| CTA header =', Math.round(rDesk.ctaSm) + 'px');
  console.log('  375px: .cards =', r.mobileCards, '| .card padding =', r.cardPad, '| CTA fixo =', Math.round(r.ctaSticky) + 'px');
  console.log('  hero bg =', r.hero, '| sticky mobile =', r.sticky, '| sticky desktop =', rDesk.sticky, '| altura =', r.altura + 'px');
  T('noscript aplicou o CSS completo (1 coluna no celular)', r.mobileCards.split(' ').length === 1, r.mobileCards);
  T('noscript aplicou o CSS completo (3 colunas de servicos no desktop)', rDesk.grid3.split(' ').length === 3, rDesk.grid3);
  T('noscript aplicou o CSS completo (2 colunas de cards no desktop)', rDesk.cards.split(' ').length === 2, rDesk.cards);
  T('noscript: hero com o azul da marca', r.hero === 'rgb(2, 30, 67)', r.hero);
  T('noscript: CTA fixo visivel no celular e oculto no desktop', r.sticky !== 'none' && rDesk.sticky === 'none', r.sticky + ' / ' + rDesk.sticky);
  T('noscript: cartao com padding (prova que o CSS completo entrou)', r.cardPad !== '0px', r.cardPad);
  // design: no celular o CTA do header fica oculto (a barra fixa cobre a conversao)
  T('noscript: nav do header oculto no celular e visivel no desktop', r.nav === 'none' && rDesk.nav === 'flex', r.nav + ' / ' + rDesk.nav);
  T('noscript: CTA fixo do celular >= 44px', r.ctaSticky >= 44, Math.round(r.ctaSticky) + 'px');
  T('noscript: CTA do header >= 44px no desktop', rDesk.ctaSm >= 44, Math.round(rDesk.ctaSm) + 'px');
  T('noscript: CTA da hero >= 48px', r.ctaHero >= 48, Math.round(r.ctaHero) + 'px');

  // os CTAs continuam navegado? sobe o href esta no HTML, logo sim
   const hrefs = await ev(cdp, sid, `(() => {
     const a = [...document.querySelectorAll('a[data-wa]')];
     return { total: a.length, todosWa: a.every((x) => x.getAttribute('href').startsWith('https://wa.me/5527997806250')) };
   })()`);
   T('sem JS: os 13 CTAs apontam para o WhatsApp', hrefs.total === 13 && hrefs.todosWa, hrefs.total + ' CTAs');


  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, sid);
  writeFileSync(join(SHOTS, 'sem-js-375-dobra.png'), Buffer.from(shot.data, 'base64'));
  console.log('  captura: build/screenshots/sem-js-375-dobra.png');
  await cdp.send('Target.closeTarget', { targetId });
}

/* ===================================================================== */
/* 2) MEDICAO: com IDs vazios nada sai; com IDs de teste o evento dispara  */
/* ===================================================================== */
console.log('\n=== 2) MEDICAO (Consent Mode + evento de intencao) ===');
{
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: sid } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, sid);
  await cdp.send('Runtime.enable', {}, sid);
  await cdp.send('Network.enable', {}, sid);
  // bloqueia qualquer saida para a internet: nada pode vazar durante o teste
  await cdp.send('Network.setBlockedURLs', { urls: ['*googletagmanager.com*', '*google-analytics.com*', '*doubleclick*'] }, sid);

  // --- 2a: como esta entregue (IDs vazios) -> zero requisicooes ---
  await ir(cdp, sid, 375, 812, true);
  const entregue = await ev(cdp, sid, `(() => {
    const dl = window.dataLayer || [];
    return {
      eventos: dl.map((a) => Array.from(a).slice(0, 2).join(' ')),
      consents: dl.filter((a) => a[0] === 'consent').length,
      conceded: dl.some((a) => a[0] === 'consent' && a[2] && Object.values(a[2]).includes('granted') && a[1] === 'update'),
      externos: performance.getEntriesByType('resource').map((e) => e.name).filter((n) => !n.startsWith(location.origin)),
    };
  })()`);
  console.log('  dataLayer com IDs vazios:', JSON.stringify(entregue.eventos));
  console.log('  consent mode default negado:', entregue.consents === 1 ? 'sim (1 registro)' : 'nao');
  console.log('  requisicoes externas:', entregue.externos.length ? entregue.externos.join(' | ') : 'nenhuma');
  T('IDs vazios: nenhum consent/update concedido', !entregue.conceded, 'ok');
  T('IDs vazios: zero requisicoes a terceiros', entregue.externos.length === 0, entregue.externos.join('|') || 'nenhuma');
  T('IDs vazios: nenhum page_view enviado', !entregue.eventos.some((e) => e.includes('config')), entregue.eventos.join(' | '));

  // --- 2b: com IDs de teste injetados (so em memoria, nunca no arquivo) ---
  const jsOriginal = readFileSync(join(ROOT, 'js', 'main.js'), 'utf8');
  const jsTeste = jsOriginal
    .replace("ga4Id: null,", "ga4Id: 'G-TESTE000000',")
    .replace("adsId: null,", "adsId: 'AW-000000000',")
    .replace("consentMode: true,", "consentMode: false,");
  writeFileSync(join(profile, 'main-teste.js'), jsTeste, 'utf8');
  await ev(cdp, sid, `(() => {
    // recarrega a pagina com o arquivo de teste no lugar do original
    const s = document.createElement('script');
    s.src = '/js/main.js?v=original';
    return true;
  })()`);
  // substitui o script real: navega de novo interceptando a requisicao
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*/js/main.js*', requestStage: 'Request' }] }, sid);
  const origOnReq = async (e) => {
    try {
      await cdp.send('Fetch.fulfillRequest', {
        requestId: e.params.requestId,
        responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'application/javascript' }],
        body: Buffer.from(jsTeste, 'utf8').toString('base64'),
      }, sid);
    } catch { /* Request ja concluida */ }
  };
  const onReq = (e) => { origOnReq(e); };
  sock.addEventListener('message', async (m) => {
    const msg = JSON.parse(m.data);
    if (msg.method === 'Fetch.requestPaused') await onReq(msg);
  });
  await ir(cdp, sid, 375, 812, true);
  await sleep(900);

  const comIds = await ev(cdp, sid, `(() => {
    const dl = window.dataLayer || [];
    return dl.map((a) => Array.from(a).map((x) => (x && typeof x === 'object' ? JSON.stringify(x) : String(x))));
  })()`);
  console.log('  dataLayer com IDs de teste:');
  for (const e of comIds) console.log('    -', e.join(' | '));
   const achouConfig = comIds.some((e) => e[0] === 'config' && e[1] === 'G-TESTE000000');
  const achouAds = comIds.some((e) => e[0] === 'config' && e[1] === 'AW-000000000');
  T('com IDs: gtag carrega GA4 na 1a visita (nao espera o 1o clique)', achouConfig, achouConfig ? 'config G-TESTE000000 presente' : 'ausente');
  T('com IDs: Google Ads tambem configurado', achouAds, achouAds ? 'config AW-000000000 presente' : 'ausente');

  // clique no CTA da hero: o evento tem de sair e a navegacao nao pode ser bloqueada
  const clique = await ev(cdp, sid, `(() => {
    const dl = window.dataLayer;
    const antes = dl.length;
    const a = document.querySelector('a[data-wa="hero"]');
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    const naoCancelado = a.dispatchEvent(ev);
    const novos = dl.slice(antes).map((x) => Array.from(x).map((v) => (v && typeof v === 'object' ? JSON.stringify(v) : String(v))));
    return { naoCancelado, novos, href: a.getAttribute('href') };
  })()`);
  console.log('  eventos apos o clique na hero:');
  for (const e of clique.novos) console.log('    -', e.join(' | '));
  const wa = clique.novos.find((e) => e[0] === 'event' && e[1] === 'whatsapp_click');
  T('clique na hero gera exatamente 1 evento whatsapp_click', (clique.novos.filter((e) => e[1] === 'whatsapp_click').length === 1), JSON.stringify(clique.novos.map((e) => e[1])));
  T('o evento leva a posicao do CTA', !!wa && wa.join(' ').includes('hero_principal'), wa ? wa.join(' ') : 'sem evento');
  T('o evento nomeia a intencao de contato (nao contratacao)', !!wa && wa.join(' ').includes('whatsapp_intencao_contato'), 'ok');
  T('o clique NAO e cancelado (WhatsApp abre mesmo com JS)', clique.naoCancelado === true, 'defaultPrevented=' + !clique.naoCancelado);

  await cdp.send('Fetch.disable', {}, sid);
  await cdp.send('Target.closeTarget', { targetId });
}

/* ===================================================================== */
/* 3) WEB VITALS: CLS e LCP                                            */
/* ===================================================================== */
console.log('\n=== 3) WEB VITALS (CLS / LCP) ===');
for (const v of [{ w: 375, h: 812, t: '375' }, { w: 1440, h: 900, t: '1440' }]) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: sid } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, sid);
  await cdp.send('Runtime.enable', {}, sid);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: v.w, height: v.h, deviceScaleFactor: 1, mobile: v.w < 600 }, sid);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__vitals={cls:0,lcp:0,lcpEl:'',lcpT:0,shifts:[]};
      new PerformanceObserver((l)=>{for(const e of l.getEntries()){ if(!e.hadRecentInput){window.__vitals.cls+=e.value; window.__vitals.shifts.push(e.value.toFixed(4));}}}).observe({type:'layout-shift',buffered:true});
      new PerformanceObserver((l)=>{const es=l.getEntries(); const e=es[es.length-1]; window.__vitals.lcp=e.startTime; window.__vitals.lcpT=e.renderTime||e.loadTime; try{window.__vitals.lcpEl=e.element?(e.element.tagName+'.'+(e.element.className||'')):'?';}catch(_){window.__vitals.lcpEl='?';}}).observe({type:'largest-contentful-paint',buffered:true});`,
  }, sid);
  await cdp.send('Page.navigate', { url: URL_ }, sid);
  await sleep(1200);
  // LCP tem de ser lido NA CARGA, antes de rolar: rolar a pagina troca o
  // elemento candidato e mascara o que o usuario ve de fato ao abrir.
  const vitInicial = await ev(cdp, sid, 'window.__vitals');
  await ev(cdp, sid, `(async () => { const H=document.documentElement.scrollHeight; for(let y=0;y<=H;y+=Math.round(innerHeight*0.8)){scrollTo({top:y,behavior:'instant'});await new Promise(r=>setTimeout(r,60));} scrollTo({top:0,behavior:'instant'}); return 1; })()`);
  await sleep(900);
  const vit = await ev(cdp, sid, 'window.__vitals');
  const pa = await ev(cdp, sid, `(() => { const n = performance.getEntriesByType('navigation')[0] || {}; const fcp = performance.getEntriesByName('first-contentful-paint')[0];
    return { domInteractive: Math.round(n.domInteractive||0), load: Math.round(n.loadEventEnd||0),
             fcp: fcp?Math.round(fcp.startTime):null, transfer: n.transferSize, recursos: performance.getEntriesByType('resource').length }; })()`);
  const lcp = vitInicial.lcp || vit.lcp;
  const lcpEl = vitInicial.lcpEl || vit.lcpEl;
  console.log(`  ${v.t}px  CLS=${vit.cls.toFixed(4)} (${vit.cls < 0.1 ? 'bom' : 'ruim'})  LCP=${Math.round(lcp)}ms em <${lcpEl}>  FCP=${pa.fcp}ms  DOMContentLoaded=${pa.domInteractive}ms  recursos=${pa.recursos}`);
  if (vit.shifts.length) console.log('    shifts:', vit.shifts.join(', '));
  T(`${v.t}px sem CLS perceptivel`, vit.cls < 0.1, 'CLS=' + vit.cls.toFixed(4));
  /* O requisito real e: o LCP NAO pode ser uma imagem (hero e tipografica,
     sem foto decorativa). O bloco de texto vencedor pode ser o H1, o
     paragrafo da hero ou o H2 da primeira secao, conforme a largura. */
  T(`${v.t}px LCP e um bloco de TEXTO, nao imagem`, !/^IMG|^PICTURE/i.test(lcpEl), lcpEl);
  T(`${v.t}px LCP < 2.5s (local, sem rede)`, lcp < 2500, Math.round(lcp) + 'ms');
  const acima = await ev(cdp, sid, `(() => {
    const out = [];
    for (const el of document.querySelectorAll('img')) {
      const r = el.getBoundingClientRect();
      if (r.top < innerHeight) out.push({ src: el.currentSrc.split('/').pop() || el.src.split('/').pop(), w: Math.round(r.width), h: Math.round(r.height) });
    }
    const h1 = document.querySelector('h1').getBoundingClientRect();
    return { imagens: out, h1Visivel: h1.top < innerHeight && h1.bottom > 0, h1Topo: Math.round(h1.top) };
  })()`);
  console.log(`    imagens na 1a dobra: ${acima.imagens.length ? acima.imagens.map((i) => `${i.src} ${i.w}x${i.h}`).join(', ') : 'nenhuma'}`);
  console.log(`    h1 visivel na 1a dobra: ${acima.h1Visivel} (top=${acima.h1Topo}px)`);
  T(`${v.t}px h1 visivel logo acima da dobra`, acima.h1Visivel, 'top=' + acima.h1Topo + 'px');
  T(`${v.t}px nenhuma imagem grande na 1a dobra (logo <= 180px)`, acima.imagens.every((i) => i.w <= 180), acima.imagens.map((i) => i.src + ':' + i.w).join(' | ') || 'nenhuma');
  await cdp.send('Target.closeTarget', { targetId });
}

console.log('\n================ RESUMO ================');
console.log('falhas:', falhas.length);
for (const f of falhas) console.log('  x', f);
writeFileSync(join(ROOT, 'build', 'behavior-tests.json'), JSON.stringify({ falhas }, null, 2));
sock.close(); chrome.kill();
process.exit(falhas.length ? 1 : 0);
