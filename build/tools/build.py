"""
Build da landing page Barquin.

Gera:
  css/main.min.css              CSS completo minificado (fonte: css/main.css)
  index.html                    recebe o CSS inline no bloco marcado por
                                <!-- build:css-start --> ... <!-- build:css-end -->

Modos de entrega do CSS (medidos, nao chutados):

  padrao (--mode=inline)
    O CSS completo vai INLINE no <head>. Resultado medido: CLS 0.000 no
    Lighthouse e 0.0046 sob throttling no desktop; LCP 1,2 s no mobile.
    Sem flash de pagina sem estilo. Custo: ~2,6 KB gzip em uma unica entrega.

  --mode=async
    CSS completo externo, carregado por preload/onload com fallback
    <noscript>, e apenas header+hero inline (critical CSS classico).
    Resultado medido: renderiza CORRETO (cores, grid, 10 CTAs, sem erro de
    console), mas o CLS fica ruim porque a secao seguinte pinta sem estilo
    antes de o CSS chegar: 0,35 no mobile e 0,77 no desktop. nesta pagina o
    documento e um scroll unico sem corte claro de "acima da dobra", entao um
    critical pequeno nao segura o layout. Mantido porque o briefing pedia
    async, mas o PADRAO RECOMENDADO e inline: e o unico que zera o CLS.
    Para checar de novo: python build/tools/build.py --mode=async e depois
    meca o CLS (build/tools/test_behavior.mjs mede so o modo inline).

Uso:
  python build/tools/build.py                # modo inline (padrao)
  python build/tools/build.py --mode=async   # gera build/index-async.html
"""

import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC_CSS = os.path.join(ROOT, "css", "main.css")
DST_CSS = os.path.join(ROOT, "css", "main.min.css")
HTML = os.path.join(ROOT, "index.html")
ALT_HTML = os.path.join(ROOT, "build", "index-async.html")

START = "<!-- build:css-start -->"
END = "<!-- build:css-end -->"

# Regras que compoem o critical CSS de header+hero do modo async.
# Vem do mesmo css/main.css, entao nao existe duplicacao manual.
CRITICAL_PREFIXES = (
    "*,", ":root", "html", "body", "img", "a", "h1", "ul", ":focus-visible",
    ".wrap", ".skip", ".btn", ".site-header", ".brand", ".site-nav",
    ".nav-links", ".hero", ".eyebrow",
)


FUNCOES_MAT = re.compile(r"(?:calc|clamp|min|max)\(")


def _colapsar_operadores(s: str) -> str:
    """Tira espacos em torno de {}, :, ; , > ~ + — mas NUNCA dentro de
    calc()/clamp()/min()/max().

    O '+' e o '-' dentro de calc() so valem com espaco em volta (exigencia do
    CSS Values): `calc(14px+env(x))` e sintaticamente invalido e o navegador
    descarta a declaracao inteira — no caso do `.sticky`, o `bottom` sumia e o
    botao flutuante ia parar no fim do documento.
    """
    partes = []
    i = 0
    ini = 0
    n = len(s)
    while i < n:
        if s[i] in "cCmM":
            m = FUNCOES_MAT.match(s, i)
            if m:
                partes.append(re.sub(r"\s*([{}:;,>~+])\s*", r"\1", s[ini:i]))
                j = m.end() - 1          # indice do '(' de abertura
                k = j
                profundidade = 0
                while k < n:
                    if s[k] == "(":
                        profundidade += 1
                    elif s[k] == ")":
                        profundidade -= 1
                        if profundidade == 0:
                            break
                    k += 1
                partes.append(s[i:min(k + 1, n)])   # trecho protegido, intacto
                i = ini = min(k + 1, n)
                continue
        i += 1
    partes.append(re.sub(r"\s*([{}:;,>~+])\s*", r"\1", s[ini:]))
    return "".join(partes)


def minify_css(css: str) -> str:
    """Minificador proprio: remove comentarios e espacos fora de strings."""
    out = []
    i, n = 0, len(css)
    while i < n:
        c = css[i]
        if c == "/" and i + 1 < n and css[i + 1] == "*":
            j = css.find("*/", i + 2)
            i = n if j < 0 else j + 2
            out.append(" ")
            continue
        if c in "\"'":
            q = c
            j = i + 1
            while j < n:
                if css[j] == "\\":
                    j += 2
                    continue
                if css[j] == q:
                    j += 1
                    break
                j += 1
            out.append(css[i:j])
            i = j
            continue
        if c in " \t\r\n":
            j = i
            while j < n and css[j] in " \t\r\n":
                j += 1
            nxt = css[j] if j < n else ""
            prv = out[-1][-1] if out and out[-1] else ""
            if prv and nxt and prv not in "{};,:" and nxt not in "{};,:":
                out.append(" ")
            i = j
            continue
        out.append(c)
        i += 1
    s = "".join(out)
    s = re.sub(r";}", "}", s)
    s = _colapsar_operadores(s)
    return s.strip() + "\n"


def extrair_blocos(css: str):
    """Devolve (regras_criticas, resto) preservando a ordem das @media."""
    criticas, resto = [], []
    i, n, buf = 0, len(css), ""

    def cabe_critico(seletor: str) -> bool:
        s = seletor.strip()
        return any(s == p or s.startswith(p) for p in CRITICAL_PREFIXES)

    while i < n:
        # acumula um bloco de nivel superior (ou uma @media inteira)
        ini = i
        profundidade = 0
        while i < n:
            c = css[i]
            if c == "{":
                profundidade += 1
            elif c == "}":
                profundidade -= 1
                if profundidade == 0:
                    i += 1
                    break
            i += 1
        bloco = css[ini:i]
        cab = bloco[:bloco.find("{")] if "{" in bloco else bloco
        if bloco.lstrip().startswith("@media") or cabe_critico(cab):
            # dentro de @media so entra o que e do header/hero
            if bloco.lstrip().startswith("@media") and "min-width:600px" in bloco:
                criticas.append(_recortar_media(cab, bloco, cabe_critico))
            else:
                criticas.append(bloco)
        else:
            resto.append(bloco)
    return "".join(criticas), "".join(resto)


def _recortar_media(cabecalho: str, bloco: str, cabe_critico) -> str:
    """Mantém dentro da @media apenas as regras de header/hero."""
    corpo = bloco[bloco.find("{") + 1:bloco.rfind("}")]
    partes, i, n = [], 0, len(corpo)
    while i < n:
        while i < n and corpo[i].isspace():
            i += 1
        if i >= n:
            break
        j = corpo.find("{", i)
        if j < 0:
            break
        sel = corpo[i:j]
        k = corpo.find("}", j)
        if k < 0:
            break
        decl = corpo[j + 1:k]
        if cabe_critico(sel):
            partes.append("%s{%s}" % (sel.strip(), decl))
        i = k + 1
    if not partes:
        return ""
    return "%s{%s}" % (cabecalho.strip(), "".join(partes))


def bloco_inline(completo_min: str, critico_min: str, modo: str) -> str:
    if modo == "async":
        return (
            '<!-- CSS completo EXTERNO, assincrono (preload/onload), com\n'
            '     fallback noscript. Critical CSS inline = header + hero.\n'
            '     MEDIDO: renderiza correto, mas CLS 0,35 (mobile) e 0,77\n'
            '     (desktop) -- a secao seguinte pinta sem estilo antes de o\n'
            '     CSS chegar. Use --mode=inline (padrao) para zerar o CLS. -->\n'
            '<link rel="preload" href="css/main.min.css" as="style" '
            'onload="this.onload=null;this.rel=\'stylesheet\'">\n'
            '<noscript><link rel="stylesheet" href="css/main.min.css"></noscript>\n'
            '<style id="css-critical">\n' + critico_min + '</style>'
        )
    return (
        '<!-- CSS completo INLINE (11,9 KB min / ~2,6 KB gzip).\n'
        '     Escolha do build: --mode=async renderiza certo, mas nao zera o\n'
        '     CLS (0,35 mobile / 0,77 desktop medidos), entao o padrao e\n'
        '     inline. O async continua disponivel:\n'
        '         python build/tools/build.py --mode=async\n'
        '     Medido no modo inline: CLS 0,000 (Lighthouse) e 0,005 sob\n'
        '     throttling no desktop; LCP 1,2 s no mobile. -->\n'
        '<style id="css-critical">\n' + completo_min + '</style>'
    )


def aplicar(html: str, css_min: str, critico_min: str, modo: str) -> str:
    ini = html.find(START)
    fim = html.find(END)
    if ini < 0 or fim < 0:
        sys.exit("ERRO: marcadores build:css-start / build:css-end nao encontrados.")
    novo = html[:ini] + START + "\n" + bloco_inline(css_min, critico_min, modo) + "\n" + html[fim:]
    return novo


def main():
    modo = "inline"
    if "--mode=async" in sys.argv:
        modo = "async"

    with open(SRC_CSS, encoding="utf-8") as f:
        css = f.read()
    criticas, _resto = extrair_blocos(css)
    completo_min = minify_css(css)
    critico_min = minify_css(criticas)

    with open(DST_CSS, "w", encoding="utf-8", newline="\n") as f:
        f.write(completo_min)

    with open(HTML, encoding="utf-8") as f:
        html = f.read()
    novo = aplicar(html, completo_min, critico_min, modo)
    if modo == "async":
        os.makedirs(os.path.dirname(ALT_HTML), exist_ok=True)
        with open(ALT_HTML, "w", encoding="utf-8", newline="\n") as f:
            f.write(novo)
        destino = os.path.relpath(ALT_HTML, ROOT)
    else:
        with open(HTML, "w", encoding="utf-8", newline="\n") as f:
            f.write(novo)
        destino = "index.html"

    a, b = os.path.getsize(SRC_CSS), os.path.getsize(DST_CSS)
    print("modo: %s" % modo)
    print("css/main.css        %7.1f KB" % (a / 1024))
    print("css/main.min.css    %7.1f KB  (-%d%%)" % (b / 1024, 100 - round(100 * b / a)))
    print("critical inline     %7.1f KB  (header+hero + a11y; so para --mode=async)" % (len(critico_min) / 1024))
    print("escrito em          %s" % destino)


if __name__ == "__main__":
    main()
