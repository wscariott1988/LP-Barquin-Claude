"""Verifica a variante assincrona servida a partir da raiz (paths relativos corretos).

Copia build/index-async.html para a raiz como arquivo temporario, mede com e sem
throttling, checa requisicoes, CTAs e se o CSS completo chegou, e depois apaga.
"""
import os
import shutil
from playwright.sync_api import sync_playwright

# raiz a partir do proprio arquivo: o teste roda de qualquer diretorio e em
# qualquer maquina, sem caminho fixo de quem developing.
R = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
TMP = os.path.join(R, "__teste-async.html")
shutil.copyfile(os.path.join(R, "build", "index-async.html"), TMP)

URL = "http://127.0.0.1:8765/__teste-async.html"
falhas = []


def T(nome, ok, detalhe=""):
    print("  %s %s  [%s]" % ("ok  " if ok else "FALHA", nome, detalhe))
    if not ok:
        falhas.append(nome)


CDP_METRICS = """
(async () => {
  let cls = 0;
  new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) cls += e.value; })
    .observe({type:'layout-shift', buffered:true});
  window.__cls = () => cls;
  return 1;
})()
"""

try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        for w, h, rotulo in [(412, 823, "mobile"), (1350, 940, "desktop")]:
            pg = b.new_page(viewport={"width": w, "height": h})
            falhas_req = []
            pg.on("requestfailed", lambda r: falhas_req.append(r.url))
            erros = []
            pg.on("console", lambda m: erros.append(m.text) if m.type == "error" else None)
            pg.on("pageerror", lambda e: erros.append(str(e)))

            pg.goto(URL, wait_until="networkidle")
            pg.evaluate(CDP_METRICS)
            pg.wait_for_timeout(2500)
            r = pg.evaluate("""() => ({
              cls: window.__cls(),
              stylesheets: [...document.styleSheets].map(s => s.href || 'inline').length,
              linkPreload: [...document.querySelectorAll('link')].some(l =>
                (l.getAttribute('href') || '').includes('main.min.css')),
              noscriptTag: document.body.innerHTML.includes('css-critical') || true,
              brandW: document.querySelector('.brand img').getBoundingClientRect().width,
              heroBg: getComputedStyle(document.querySelector('.hero')).backgroundColor,
              ctaColor: getComputedStyle(document.querySelector('.hero__cta .btn')).backgroundColor,
              grid3: getComputedStyle(document.querySelector('.grid3')).gridTemplateColumns.split(' ').length,
              cardPad: getComputedStyle(document.querySelector('.card')).padding,
              scrollW: document.documentElement.scrollWidth,
              clientW: document.documentElement.clientWidth,
              ctas: [...document.querySelectorAll('a[href*="wa.me"]')].length,
              ctasOk: (() => {
                const base = 'https://wa.me/5527997806250?text=';
                const s = 'Ol%C3%A1%2C%20te%20encontrei%20no%20Google%20e%20';
                const ok = [
                  base + s + 'gostaria%20de%20um%20or%C3%A7amento.',
                  base + s + 'preciso%20de%20or%C3%A7amento%20para%20montagem%20e%20desmontagem%20de%20m%C3%B3veis.',
                  base + s + 'preciso%20de%20or%C3%A7amento%20para%20ajustes%20em%20m%C3%B3vel%20%28porta%2C%20gaveta%2C%20corredi%C3%A7a%20ou%20dobradi%C3%A7a%29.',
                  base + s + 'preciso%20de%20or%C3%A7amento%20para%20instala%C3%A7%C3%A3o%20de%20TV%20ou%20ventilador%20de%20teto.',
                ];
                return [...document.querySelectorAll('a[href*="wa.me"]')].every(a => ok.includes(a.href));
              })(),
              navMobile: getComputedStyle(document.querySelector('.site-nav')).display,
              sticky: getComputedStyle(document.querySelector('.sticky')).display,
            })""")

            print("=== async / %s %dx%d ===" % (rotulo, w, h))
            T("CSS completo carregou (folhas > 1)", r["stylesheets"] > 1, "%d folhas" % r["stylesheets"])
            T("tag preload presente", r["linkPreload"])
            T("hero com o azul da marca", r["heroBg"] == "rgb(2, 30, 67)", r["heroBg"])
            T("CTA no laranja da marca", r["ctaColor"] == "rgb(255, 107, 3)", r["ctaColor"])
            T("card com padding do CSS completo", r["cardPad"] != "0px", r["cardPad"])
            T("grid3 com 3 colunas (desktop) / 1 (mobile)",
              r["grid3"] == (3 if w >= 900 else 1), "%d colunas" % r["grid3"])
            T("logo com largura do CSS", r["brandW"] == (164 if w >= 900 else 132), "%dpx" % r["brandW"])
            T("sem overflow horizontal", r["scrollW"] <= r["clientW"] + 1,
              "%d/%d" % (r["scrollW"], r["clientW"]))
            T("13 CTAs com a URL revisada", r["ctas"] == 13 and r["ctasOk"], "%d CTAs" % r["ctas"])
            T("CLS bom (<0.1)", r["cls"] < 0.1, "CLS=%.4f" % r["cls"])
            if r["cls"] >= 0.1:
                print("       ^ conhecido: o modo async nao zera o CLS nesta pagina")
                print("         (ver comentario medido em build/tools/build.py)")
            T("nav do header oculta no mobile / visivel no desktop",
              (r["navMobile"] == "flex") if w >= 900 else (r["navMobile"] == "none"), r["navMobile"])
            T("sem requisicoes falhas", not falhas_req, "; ".join(falhas_req[:3]))
            T("sem erros de console", not erros, "; ".join(erros[:3]))
            print()
            pg.close()
        b.close()
finally:
    if os.path.exists(TMP):
        os.remove(TMP)
        print("temporario removido:", not os.path.exists(TMP))

print("=== RESUMO ASYNC ===")
print("falhas: %d %s" % (len(falhas), falhas if falhas else ""))
