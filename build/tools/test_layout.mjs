/* Testes de layout via Chrome DevTools Protocol (sem dependencias).
   uso: node build/tools/test_layout.mjs [--url=http://127.0.0.1:8765/]
*/
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const SHOTS = join(ROOT, 'build', 'screenshots');
// Caminho do Chrome resolvido em vez de fixo: assim o script roda em qualquer
// maquina. Ordem: CHROME_PATH do ambiente, instalacao padrao do Windows e,
// por ultimo, o chrome que estiver no PATH.
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
const argUrl = process.argv.find((a) => a.startsWith('--url='));
const URL_ = argUrl ? argUrl.slice(6) : 'http://127.0.0.1:8765/';
const PORT = 9333;

if (!existsSync(SHOTS)) mkdirSync(SHOTS, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'barquin-cdp-'));

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-sandbox',
  '--no-first-run', '--disable-extensions', '--mute-audio',
  '--disable-background-networking', '--disable-sync',
  '--force-device-scale-factor=1', '--font-render-hinting=none',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function wsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      const j = await r.json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch { /* ainda subindo */ }
    await sleep(250);
  }
  throw new Error('Chrome nao subiu na porta de depuracao');
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
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((res, rej) => {
      this.pend.set(id, { res, rej });
      setTimeout(() => {
        if (this.pend.has(id)) { this.pend.delete(id); rej(new Error('timeout ' + method)); }
      }, 30000);
    });
  }
}

/* ---------------------- bateria de verificacoes no browser -------------- */
// async: o teste do botao flutuante rola a pagina e espera o layout assentar
const SUITE = `(async () => {
  const R = { checks: [], falhas: [] };
  const add = (nome, ok, detalhe) => R.checks.push({ nome, ok: !!ok, detalhe: String(detalhe ?? '') });
  const fail = (nome, detalhe) => { R.falhas.push(nome + ' :: ' + detalhe); };
  const T = (nome, ok, det) => { add(nome, ok, det); if (!ok) fail(nome, det); };

  const de = window.devicePixelRatio || 1;
  const W = document.documentElement.clientWidth;

  // 1) sem overflow horizontal
  const sw = document.documentElement.scrollWidth;
  const over = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  T('sem overflow horizontal', over <= 1, 'scrollWidth=' + sw + ' clientWidth=' + W + ' excesso=' + over + 'px');
  if (over > 1) {
    const culpados = [...document.querySelectorAll('body *')]
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter((o) => o.r.right > W + 1 || o.r.left < -1)
      .slice(0, 8)
      .map((o) => o.el.tagName.toLowerCase() + '.' + (o.el.className || '').toString().split(' ')[0] + ' right=' + Math.round(o.r.right));
    R.culpaOverflow = culpados;
  }

  // 2) todos os CTAs apontam para o WhatsApp, com mensagem revisada
  const SAUDACAO = 'Ol%C3%A1%2C%20te%20encontrei%20no%20Google%20e%20';
  const NUM = 'https://wa.me/5527997806250?text=';
  const WA_PERMITIDAS = [
    NUM + SAUDACAO + 'gostaria%20de%20um%20or%C3%A7amento.',
    NUM + SAUDACAO + 'preciso%20de%20or%C3%A7amento%20para%20montagem%20e%20desmontagem%20de%20m%C3%B3veis.',
    NUM + SAUDACAO + 'preciso%20de%20or%C3%A7amento%20para%20ajustes%20em%20m%C3%B3vel%20%28porta%2C%20gaveta%2C%20corredi%C3%A7a%20ou%20dobradi%C3%A7a%29.',
    NUM + SAUDACAO + 'preciso%20de%20or%C3%A7amento%20para%20instala%C3%A7%C3%A3o%20de%20TV%20ou%20ventilador%20de%20teto.',
  ];
  const ctas = [...document.querySelectorAll('a[data-wa]')];
  const errados = ctas.filter((a) => !WA_PERMITIDAS.includes(a.href)).map((a) => a.getAttribute('data-wa') + ' -> ' + a.href);
  T('CTAs com URL exata do WhatsApp', ctas.length === 13 && errados.length === 0, ctas.length + ' CTAs; divergentes: ' + (errados.join(' | ') || 'nenhum'));

  // 3) alvos de toque >= 44px
  const pequenos = [...document.querySelectorAll('a[data-wa], button, .faq__i summary')]
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter((o) => o.r.width > 0 && (o.r.height < 43.5 || o.r.width < 43.5))
    .map((o) => (o.el.className || o.el.tagName).toString().split(' ')[0] + ' ' + Math.round(o.r.width) + 'x' + Math.round(o.r.height));
  T('alvos de toque >= 44px', pequenos.length === 0, pequenos.length ? pequenos.join(' | ') : 'todos ok');

  // 4) CTA fixo: visivel no celular, oculto no desktop
  const sticky = document.querySelector('.sticky');
  const sr = sticky ? getComputedStyle(sticky) : null;
  const stickyVisivel = sticky && sr.display !== 'none';
   const esperado = W < 600;
  T('CTA fixo coerente com a largura', stickyVisivel === esperado, 'largura=' + W + ' exibindo=' + stickyVisivel + ' (esperado ' + esperado + ')');
  if (stickyVisivel) {
    const r = sticky.getBoundingClientRect();
    const b = sticky.querySelector('.btn').getBoundingClientRect();
    T('CTA fixo acima da dobra e legivel', b.bottom <= innerHeight + 1 && b.height >= 48, 'bottom=' + Math.round(b.bottom) + ' innerHeight=' + innerHeight + ' altura=' + Math.round(b.height));
  }

  // 5) corpo nao fica escondido atras do CTA fixo
  // O CTA virou um botao flutuante no canto: ele nao ocupa uma faixa inteira,
  // entao a reserva e so o respiro do safe-area, e o que importa e nenhum link
  // do rodape ficar coberto pelo botao quando a pagina esta no fim do rolagem.
  const bodyPB = parseFloat(getComputedStyle(document.body).paddingBottom);
  T('reserva de espaco no fim da pagina', !stickyVisivel || bodyPB >= 16, 'padding-bottom=' + bodyPB + 'px');
  if (stickyVisivel) {
    scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
    await new Promise((r) => setTimeout(r, 250));
    const fab = document.querySelector('.sticky__btn').getBoundingClientRect();
    const alvos = [...document.querySelectorAll('footer a, footer button, footer p, footer li')]
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter((o) => o.r.width > 0 && o.r.bottom <= innerHeight + 2 && o.r.bottom > 0);
    const cobertos = alvos.filter((o) => !(o.r.right < fab.left || o.r.left > fab.right || o.r.bottom < fab.top || o.r.top > fab.bottom));
    T('nenhum item do rodape coberto pelo botao flutuante', cobertos.length === 0,
      cobertos.map((o) => (o.el.className || o.el.tagName).toString().split(' ')[0] + ' -> ' + Math.round(o.r.left) + '-' + Math.round(o.r.right)).join(' | ') || 'ok');
    scrollTo({ top: 0, behavior: 'instant' });
    await new Promise((r) => setTimeout(r, 150));
  }

  // 6) cores criticas aplicadas
  const hero = document.querySelector('.hero');
  const hc = hero ? getComputedStyle(hero) : null;
  T('fundo da hero no azul da marca', hc && hc.backgroundColor === 'rgb(2, 30, 67)', hc ? hc.backgroundColor : 'sem hero');
  const cta = document.querySelector('.btn--wa');
  const cc = cta ? getComputedStyle(cta) : null;
  T('CTA no laranja da marca', cc && cc.backgroundColor === 'rgb(255, 107, 3)', cc ? cc.backgroundColor : 'sem CTA');

  // 7) corpo do texto >= 16px (evita zoom no iOS). Eyebrow e chip sao
  //    rotulos curtos em caixa alta: ficam fora da checagem.
  const chips = new Set(['eyebrow', 'btn', 'cbtn', 'rev__stars', 'carrossel__pos', 'hero__exp', 'grp__t']);
  const corpo = [...document.querySelectorAll('p, li, blockquote, .card p')]
    .filter((el) => !chips.has([...el.classList].join(' ')))
    .map((el) => ({ el, fs: parseFloat(getComputedStyle(el).fontSize) }))
    .filter((o) => o.fs < 16 && o.el.textContent.trim().length > 45);
  T('texto corrido >= 16px', corpo.length === 0, corpo.length ? corpo.slice(0, 5).map((o) => (o.el.className || o.el.tagName) + ':' + o.fs + 'px').join(' | ') : 'ok');

  // 8) imagens carregadas (apos rolar a pagina inteira)
  const imgs = [...document.images].map((i, k) => ({
    rot: k + ':' + (i.closest('header') ? 'header' : i.closest('footer') ? 'rodape' : i.closest('.conf__c') ? 'confianca' : 'corpo'),
    ok: i.complete && i.naturalWidth > 0, w: i.naturalWidth, h: i.naturalHeight,
  }));
  T('todas as imagens carregam', imgs.every((i) => i.ok), imgs.map((i) => i.rot + (i.ok ? ':' + i.w + 'x' + i.h : ':NAO CARREGOU')).join(' | '));

  // 9) imgs com width/height (CLS) e alt
  const semDim = [...document.images].filter((i) => !i.getAttribute('width') || !i.getAttribute('height')).map((i) => i.src.split('/').pop());
  T('imagens com width/height', semDim.length === 0, semDim.join(',') || 'ok');
  const semAlt = [...document.images].filter((i) => !i.getAttribute('alt')).map((i) => i.src.split('/').pop());
  T('imagens com alt', semAlt.length === 0, semAlt.join(',') || 'ok');

  // 10) carrossel: estado honesto quando nao ha avaliacoes
  const car = document.querySelector('[data-carrossel]');
  R.carrossel = car ? { hidden: car.hidden, itens: car.querySelectorAll('[data-carrossel-track] > *').length } : null;
  T('carrossel coerente com os dados', car && (car.hidden === (R.carrossel.itens === 0)), 'hidden=' + (car ? car.hidden : '?') + ' itens=' + (R.carrossel ? R.carrossel.itens : 0));

  // 11) painel de privacidade fechado por padrao
  const pp = document.querySelector('[data-priv-panel]');
  T('painel de privacidade inicia fechado', pp && pp.hidden === true, 'hidden=' + (pp ? pp.hidden : 'sem painel'));
  if (pp) {
    const btn = document.querySelector('[data-priv]');
    btn.click();
    T('painel de privacidade abre ao clicar', pp.hidden === false, 'hidden=' + pp.hidden + ' aria-expanded=' + btn.getAttribute('aria-expanded'));
    btn.click();
  }

  // 12) nenhum pedido a terceiros nesta visita
  R.terceiros = performance.getEntriesByType('resource')
    .map((e) => e.name)
    .filter((n) => !n.startsWith(location.origin) && !n.startsWith('data:'));

  // 13) hierarquia de titulos
  R.h1 = [...document.querySelectorAll('h1')].map((h) => h.textContent.trim());
  T('exatamente um h1', R.h1.length === 1, R.h1.length + ' h1');
  const h2 = document.querySelectorAll('h2').length;
  T('h2 presentes', h2 >= 5, h2 + ' h2');

  // 14) link de pular para o conteudo
  T('link pular para o conteudo', !!document.querySelector('.skip[href="#conteudo"]'), 'ok');

  // 15) sem erros de console capturado
  R.larguraViewport = W;
  R.alturaPagina = document.documentElement.scrollHeight;
  return R;
})()`;

/* --------- teste do carrossel com 6 avaliacoes de fixture (temporario) --- */
const FIXTURE = `(() => {
  const track = document.querySelector('[data-carrossel-track]');
  const car = document.querySelector('[data-carrossel]');
  if (!track) return { erro: 'sem track' };
  const notas = [
    ['Ana Paula M.', 5, 'Montaram uma cama de casal com cabeceira. Muito limpos e cuidadosos.'],
    ['Carlos E.', 5, 'Contratei para montagem de cozinha e instalacao de TV. Tudo no lugar.'],
    ['Juliana R.', 5, 'Montaram moveis da sala e trocaram as corrediças. Recomendo demais.'],
    ['Marcos T.', 5, 'Atendimento pontual, explicaram tudo antes de comecar e o preco combinou.'],
    ['Patrícia S.', 5, 'Pegaram um movei de Santo Andre para Serra. Cuidadosos com tudo.'],
    ['Roberto L.', 5, 'Refizeram os ajustes das portas e gavetas. Resolvido.'],
  ];
  track.innerHTML = notas.map(([a, n, t], i) =>
    '<li><figure class="rev__c"><div class="rev__top">' +
    '<span class="rev__stars" aria-label="' + n + ' de 5 estrelas">' + '&#9733;'.repeat(n) + '</span>' +
    '<figcaption class="rev__autor">' + a + '</figcaption></div>' +
    '<blockquote>' + t + '</blockquote></figure></li>').join('');
  car.hidden = false;
  return { itens: track.children.length };
})()`;

const CONSERVE_CARR = `(() => {
  const car = document.querySelector('[data-carrossel]');
  const track = car.querySelector('[data-carrossel-track]');
  const prev = car.querySelector('[data-carrossel-prev]');
  const next = car.querySelector('[data-carrossel-next]');
  const st = car.querySelector('[data-carrossel-status]');
  const out = { visiveis: 0, passo: 0, track: 0, role: track.getAttribute('role') || null, rotulos: {} };
  const item = track.firstElementChild.getBoundingClientRect();
  const cs = getComputedStyle(track);
  out.passo = Math.round(item.width + (parseFloat(cs.columnGap) || 0));
  const vis = Math.round(track.clientWidth / out.passo);
  out.visiveis = vis;
  out.track = track.scrollWidth;
  out.rotulos.prev = prev.getAttribute('aria-label');
  out.rotulos.next = next.getAttribute('aria-label');
  out.status = st.textContent.trim();
  out.prevDisabled = prev.disabled;
  out.nextDisabled = next.disabled;
  return out;
})()`;

const CLIQUE = `(() => {
  const car = document.querySelector('[data-carrossel]');
  const next = car.querySelector('[data-carrossel-next]');
  const track = car.querySelector('[data-carrossel-track]');
  const antes = track.scrollLeft;
  next.click();
  return { antes, clicked: true };
})()`;

const APOS_CLIQUE = `(() => {
  const car = document.querySelector('[data-carrossel]');
  const track = car.querySelector('[data-carrossel-track]');
  const prev = car.querySelector('[data-carrossel-prev]');
  const next = car.querySelector('[data-carrossel-next]');
  return {
    scrollLeft: Math.round(track.scrollLeft),
    prevDisabled: prev.disabled,
    nextDisabled: next.disabled,
    status: car.querySelector('[data-carrossel-status]').textContent.trim(),
  };
})()`;

const IR_FIM = `(() => {
  const car = document.querySelector('[data-carrossel]');
  const next = car.querySelector('[data-carrossel-next]');
  for (let i = 0; i < 12; i++) { if (next.disabled) break; next.click(); }
  return true;
})()`;

async function evaluate(cdp, sid, expr) {
  const r = await cdp.send('Runtime.evaluate', {
    expression: expr, returnByValue: true, awaitPromise: true,
  }, sid);
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result.value;
}

async function irPara(cdp, sid, url, w, h, mobile = true) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: w, height: h, deviceScaleFactor: 1, mobile,
    screenWidth: w, screenHeight: h,
  }, sid);
  await cdp.send('Page.navigate', { url }, sid);
  await sleep(1400);
  await cdp.send('Runtime.evaluate', { expression: 'document.fonts ? document.fonts.ready.then(()=>1) : 1', awaitPromise: true }, sid);
  await sleep(400);
}

/* Rola a pagina inteira para disparar as imagens com loading="lazy".
   Sem isso, imagens abaixo da dobra aparecem como "nao carregadas". */
const ROLAR = `(async () => {
  const passo = Math.round(innerHeight * 0.8);
  const H = document.documentElement.scrollHeight;
  /* behavior:'instant' ignora o scroll-behavior:smooth do CSS, senao a
     rolagem e lenta demais e as imagens lazy do rodape nunca disparam. */
  for (let y = 0; y <= H; y += passo) {
    scrollTo({ top: y, behavior: 'instant' });
    await new Promise((r) => setTimeout(r, 70));
  }
  scrollTo({ top: H, behavior: 'instant' });
  await new Promise((r) => setTimeout(r, 200));
  const esperadas = [...document.images];
  await Promise.all(esperadas.map((i) => i.complete ? 1 : new Promise((r) => {
    i.addEventListener('load', r, { once: true }); i.addEventListener('error', r, { once: true });
    setTimeout(r, 2500);
  })));
  scrollTo({ top: 0, behavior: 'instant' });
  await new Promise((r) => setTimeout(r, 250));
  return true;
})()`;

async function shot(cdp, sid, nome, full = true) {
  const params = { format: 'png', captureBeyondViewport: full };
  if (full) {
    const m = await cdp.send('Page.getLayoutMetrics', {}, sid);
    params.clip = { x: 0, y: 0, width: m.cssContentSize.width, height: m.cssContentSize.height, scale: 1 };
  }
  const r = await cdp.send('Page.captureScreenshot', params, sid);
  const buf = Buffer.from(r.data, 'base64');
  const p = join(SHOTS, nome + '.png');
  writeFileSync(p, buf);
  return { nome, bytes: buf.length, w: params.clip ? Math.round(params.clip.width) : 0, h: params.clip ? Math.round(params.clip.height) : 0 };
}

/* ----------------------------------- run -------------------------------- */
const out = [];
const url = await wsUrl();
const sock = new WebSocket(url);
await new Promise((res, rej) => { sock.addEventListener('open', res); sock.addEventListener('error', rej); });
const cdp = new CDP(sock);
const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
const { sessionId: sid } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
await cdp.send('Page.enable', {}, sid);
await cdp.send('Runtime.enable', {}, sid);
await cdp.send('Network.enable', {}, sid);
await cdp.send('Network.setCacheDisabled', { cacheDisabled: true }, sid);
await cdp.send('Log.enable', {}, sid);
await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] }, sid);

const VIEWS = [
  { w: 320, h: 700, mobile: true, tag: '320' },
  { w: 375, h: 812, mobile: true, tag: '375' },
  { w: 414, h: 896, mobile: true, tag: '414' },
  { w: 768, h: 1024, mobile: false, tag: '768' },
  { w: 1024, h: 768, mobile: false, tag: '1024' },
  { w: 1440, h: 900, mobile: false, tag: '1440' },
];

const erros = [];
for (const v of VIEWS) {
  await irPara(cdp, sid, URL_, v.w, v.h, v.mobile);
  await evaluate(cdp, sid, ROLAR);
  const r = await evaluate(cdp, sid, SUITE);
  out.push({ view: v.tag, ...r });
  const s = await shot(cdp, sid, `lp-${v.tag}-completa`, true);
  const s2 = await shot(cdp, sid, `lp-${v.tag}-dobra`, false);
  console.log(`\n=== ${v.tag}px === altura=${r.alturaPagina}px falhas=${r.falhas.length}`);
  for (const c of r.checks) console.log(`  ${c.ok ? 'ok  ' : 'FALHA'} ${c.nome}${c.detalhe ? '  [' + c.detalhe + ']' : ''}`);
  if (r.culpaOverflow) console.log('  culpados:', r.culpaOverflow.join(' | '));
  if (r.terceiros.length) console.log('  TERCEIROS:', r.terceiros.join(' | '));
  console.log(`  captura completa ${s.w}x${s.h} ${(s.bytes / 1024).toFixed(0)}KB | dobra ${(s2.bytes / 1024).toFixed(0)}KB`);
  for (const f of r.falhas) erros.push(`[${v.tag}] ${f}`);
}

/* ----------------------- carrossel com fixture ---------------------------- */
console.log('\n=== CARROSSEL (fixture de 6 avaliacoes, somente teste) ===');
const v = { w: 375, h: 812, mobile: true };
await irPara(cdp, sid, URL_, v.w, v.h, true);
const fx = await evaluate(cdp, sid, FIXTURE);
await sleep(400);
const c1 = await evaluate(cdp, sid, CONSERVE_CARR);
console.log('  apos injetar:', JSON.stringify(fx));
console.log('  375px  ', JSON.stringify(c1));
await evaluate(cdp, sid, CLIQUE);
await sleep(900);
const c2 = await evaluate(cdp, sid, APOS_CLIQUE);
console.log('  apos next:', JSON.stringify(c2));
if (c2.scrollLeft <= 0) erros.push('carrossel: botao next nao advancei o scroll');
if (c2.prevDisabled) erros.push('carrossel: prev continuou desabilitado apos avancar');
const shotCar = await shot(cdp, sid, 'carrossel-375-2-cards', false);
console.log(`  captura carrossel ${(shotCar.bytes / 1024).toFixed(0)}KB`);

await irPara(cdp, sid, URL_, 1440, 900, false);
await evaluate(cdp, sid, FIXTURE);
await sleep(400);
const d1 = await evaluate(cdp, sid, CONSERVE_CARR);
console.log('  1440px ', JSON.stringify(d1));
if (d1.visiveis !== 3) erros.push(`carrossel desktop: esperado 3 visiveis, veio ${d1.visiveis}`);
const shotCarD = await shot(cdp, sid, 'carrossel-1440-3-cards', false);
console.log(`  captura carrossel desktop ${(shotCarD.bytes / 1024).toFixed(0)}KB`);

await evaluate(cdp, sid, IR_FIM);
await sleep(1200);
const c3 = await evaluate(cdp, sid, APOS_CLIQUE);
console.log('  apos ir ao fim:', JSON.stringify(c3));
if (!c3.nextDisabled) erros.push('carrossel: next nao desabilitou no fim da trilha');

/* -------------------------- erros de console ----------------------------- */
const consoleErr = cdp.ev
  .filter((e) => e.method === 'Log.entryAdded' && ['error', 'warning'].includes(e.params?.entry?.level))
  .map((e) => e.params.entry.level + ': ' + e.params.entry.text + ' ' + (e.params.entry.url || ''));
const excecoes = cdp.ev
  .filter((e) => e.method === 'Runtime.exceptionThrown')
  .map((e) => e.params.exceptionDetails.text + ' ' + (e.params.exceptionDetails.exception?.description || ''));
const falhasReq = cdp.ev
  .filter((e) => e.method === 'Network.loadingFailed')
  .map((e) => e.params.errorText);
console.log('\n=== CONSOLE / REDE ===');
console.log('  entradas de erro/aviso:', consoleErr.length ? consoleErr.join(' | ') : 'nenhuma');
console.log('  excecoes JS:', excecoes.length ? excecoes.join(' | ') : 'nenhuma');
console.log('  requisicoes falhas:', falhasReq.length ? falhasReq.join(' | ') : 'nenhuma');

console.log('\n================ RESUMO ================');
console.log('falhas:', erros.length);
for (const e of erros) console.log('  x', e);

writeFileSync(join(ROOT, 'build', 'layout-tests.json'), JSON.stringify({ views: out, carousel: { c1, c2, c3, d1 }, consoleErr, excecoes, falhasReq, falhas: erros }, null, 2));
console.log('\nrelatorio: build/layout-tests.json');
console.log('capturas:  build/screenshots/');

sock.close();
chrome.kill();
process.exit(erros.length ? 1 : 0);
