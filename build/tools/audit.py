"""
Auditoria estatica da landing page (sem navegador).
Uso: python build/tools/audit.py
Saida: build/audit.txt
"""

import os
import re
import sys
from html.parser import HTMLParser
from urllib.parse import quote, unquote

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
HTML = os.path.join(ROOT, "index.html")

NUMERO_WA = "5527997806250"


def wa(texto):
    """Monta a URL do WhatsApp exatamente como o navegador a le do HTML."""
    return "https://wa.me/%s?text=%s" % (NUMERO_WA, quote(texto, safe=""))


SAUDACAO = "Olá, te encontrei no Google e"
MSG_PADRAO = SAUDACAO + " gostaria de um orçamento."

# Allowlist: toda URL de WhatsApp da pagina precisa estar aqui. Mensagem nova
# fora desta lista e bloqueante, porque muda o texto da campanha e quebra o
# rastreamento por data-wa-pos sem passar por revisao.
MSG_REVISADAS = (
    MSG_PADRAO,
    SAUDACAO + " preciso de orçamento para montagem e desmontagem de móveis.",
    SAUDACAO + " preciso de orçamento para ajustes em móvel "
              "(porta, gaveta, corrediça ou dobradiça).",
    SAUDACAO + " preciso de orçamento para instalação de TV ou ventilador de teto.",
)
WA_PERMITIDOS = frozenset(wa(m) for m in MSG_REVISADAS)

# termos que nunca podem aparecer na pagina final
PROIBIDOS = ["lorem ipsum", "ipsum", "xxx", "undefined", "NaN",
             "example.com", "TODO", "FIXME", "FURNITURE ARRIVES",
             "자체", "wns de aviso", "SEU-NOME-AQUI", "G-XXXX",
             "AW-XXXX"]

problemas = []
avisos = []


class Coletor(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.wa = []            # (href, data-wa, data-wa-pos)
        self.locais = []        # src/href de arquivos locais
        self.imgs = []          # (src, alt, w, h, loading)
        self.textos = []
        self.ids = []
        self.hrefs_hash = []
        self.links_ext = []
        self.tags_abertas = []
        self.inputs_sem_label = []
        self._pilha = []
        self._buf = []
        self._fora_da_p = 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        self._pilha.append(tag)
        if "id" in a:
            self.ids.append(a["id"])
        if tag == "img":
            self.imgs.append((a.get("src", ""), a.get("alt"),
                              a.get("width"), a.get("height"), a.get("loading")))
        for chave in ("src", "href", "poster", "content"):
            v = a.get(chave)
            if not v or v.startswith(("http://", "https://", "data:", "mailto:", "tel:", "#")):
                continue
            if tag == "meta" and chave == "content":
                continue
            self.locais.append(v.split("#")[0].split("?")[0])
        if tag == "a":
            h = a.get("href", "")
            if h.startswith("#") and len(h) > 1:
                self.hrefs_hash.append(h[1:])
            elif h.startswith(("http://", "https://")):
                self.links_ext.append(h)
            if "data-wa" in a:
                self.wa.append((h, a.get("data-wa"), a.get("data-wa-pos")))
        if tag in ("input", "select", "textarea") and a.get("type") != "hidden":
            if not (a.get("aria-label") or a.get("aria-labelledby") or a.get("id")):
                self.inputs_sem_label.append(tag)

    def handle_endtag(self, tag):
        while self._pilha:
            t = self._pilha.pop()
            if t == tag:
                break

    def handle_data(self, data):
        t = data.strip()
        if t:
            self.textos.append(t)


def kb(n):
    return f"{n/1024:.1f} KB"


def main():
    with open(HTML, encoding="utf-8") as f:
        html = f.read()

    c = Coletor()
    c.feed(html)

    # 1) CTAs de WhatsApp
    n_wa = len(c.wa)
    if n_wa == 0:
        problemas.append("Nenhum CTA com data-wa encontrado.")
    for h, pos, rot in c.wa:
        if h not in WA_PERMITIDOS:
            problemas.append(f"CTA [{rot}] com URL fora da allowlist de mensagens revisadas: {h}")
        if not pos:
            problemas.append(f"CTA [{rot}] sem data-wa-pos (evento nao nomeado).")
    sem_rotulo = [r for _, _, r in c.wa if not r]
    if sem_rotulo:
        problemas.append(f"CTA(s) sem data-wa-pos: {len(sem_rotulo)}")

    # 2) arquivos locais referenciados existem.
    #    Caminhos absolutos de raiz (/assets/...) sao exigidos pelo briefing
    #    para os icones, entao resolvemos a partir da raiz do projeto.
    faltando = []
    for ref in sorted(set(c.locais)):
        limpo = ref.lstrip("/")
        alvo = os.path.normpath(os.path.join(ROOT, limpo.replace("/", os.sep)))
        if not os.path.exists(alvo):
            faltando.append(ref)
    for ref in faltando:
        problemas.append(f"Referencia local inexistente: {ref}")

    # 3) imagens: alt e dimensoes
    for src, alt, w, h, ld in c.imgs:
        nome = os.path.basename(src.split("?")[0])
        if alt is None:
            problemas.append(f"<img> sem alt: {nome}")
        elif not alt.strip():
            problemas.append(f"<img> com alt vazio: {nome}")
        if not (w and h):
            problemas.append(f"<img> sem width/height (evita CLS): {nome}")
        if ld != "lazy" and "logo" not in nome:
            avisos.append(f"{nome} sem loading=lazy (acima da dobra: nao ideal)")

    # 4) links internos #ancora existem
    for alvo in c.hrefs_hash:
        if alvo not in c.ids:
            problemas.append(f"Ancora interna sem destino: #{alvo}")

    # 5) links externos
    for url in sorted(set(c.links_ext)):
        host = url.split("/")[2]
        if host not in ("wa.me", "www.google.com", "share.google"):
            avisos.append(f"Link externo fora da lista revisada: {url}")

    # 6) termos proibidos
    texto = " ".join(c.textos)
    for termo in PROIBIDOS:
        if termo.lower() in html.lower():
            problemas.append(f"Termo proibido no HTML: {termo!r}")

    # 7) placeholders honestos ainda presentes? As avaliacoes reais vieram de
    #    reviews.md, entao o aviso e o link para o perfil nao devem mais existir.
    if "avaliacoes__fonte" in html:
        avisos.append("Secao de avaliacoes ainda tem o bloco avaliacoes__fonte (link para o perfil).")
    if 'class="aviso"' in html:
        avisos.append("Ainda existe <p class=aviso> na pagina.")

    # As avaliacoes nao podem depender de JS para aparecerem: sem [hidden] no
    # <div class=carrossel>, e com pelo menos 3 <li class="rev"> reais.
    m_carr = re.search(r'<div class="carrossel"[^>]*>', html)
    if m_carr and "hidden" in m_carr.group(0):
        problemas.append("Carrossel nasce com [hidden]: sem JS as avaliacoes somem.")
    n_revs = html.count('<li class="rev">')
    if n_revs < 3:
        problemas.append(f"Carrossel com apenas {n_revs} avaliacoes (minimo 3).")
    elif not re.search(r'reviews\.md', html):
        avisos.append("Avaliacoes presentes mas sem referencia a reviews.md no comentario-fonte.")

    # 8) campos de configuracao vazios
    js = os.path.join(ROOT, "js", "main.js")
    with open(js, encoding="utf-8") as f:
        js_txt = f.read()
    for campo in ("ga4Id", "adsId"):
        m = re.search(campo + r":\s*([^,\n]+)", js_txt)
        if not m:
            problemas.append(f"js/main.js: campo {campo} nao encontrado.")
        elif m.group(1).strip() in ("null", "undefined", "''", '""'):
            avisos.append(f"js/main.js: {campo} ainda vazio -> nenhuma tag sera carregada.")
    if "googletagmanager.com" in js_txt and "ga4Id: null" in js_txt:
        avisos.append("gtag so carrega se ga4Id for preenchido: hoje 0 requisicooes a terceiros.")

    # 9) checagem de sintaxe basica do JS com node
    linhas = []
    if shutil_which("node"):
        rc, out = run_node_check(js)
        if rc != 0:
            problemas.append("js/main.js: erro de sintaxe: " + out.strip()[:200])
        else:
            linhas.append("js/main.js: sintaxe OK (node --check)")

    # 10) CSS: chaves balanceadas
    css = os.path.join(ROOT, "css", "main.min.css")
    with open(css, encoding="utf-8") as f:
        mini = f.read()
    if mini.count("{") != mini.count("}"):
        problemas.append("css/main.min.css: chaves nao balanceadas.")
    linhas.append(f"css/main.min.css: chaves balanceadas ({mini.count('{')} blocos)")

    # 11) contraste dos pares de cor do design.
    # A cor do texto sobre o laranja e lida do proprio CSS, para a auditoria
    # nao passar a enforcear uma cor que o CSS ja tenha abandonado.
    m_wa = re.search(r"\.btn--wa\{[^}]*?color:(#[0-9A-Fa-f]{6})", css)
    cor_wa = m_wa.group(1).lstrip("#") if m_wa else "021E43"
    for nome, fg, bg in (("laranja #FF6B03 + texto do CTA (%s)" % ("#" + cor_wa), cor_wa, "FF6B03"),
                         ("marinho #021E43 + #FFFFFF", "FFFFFF", "021E43"),
                         ("#0B2A52 sobre #FCFBFB", "0B2A52", "FCFBFB"),
                         ("#4A5C77 sobre #FCFBFB", "4A5C77", "FCFBFB"),
                         ("#B24A00 sobre #FCFBFB (CTA dos cards de servico)", "B24A00", "FCFBFB"),
                         ("#C9D6E8 sobre #021E43", "C9D6E8", "021E43")):
        r = contrast(fg, bg)
        nivel = "AAA" if r >= 7 else ("AA" if r >= 4.5 else "FALHA")
        if r < 4.5:
            problemas.append(f"Contraste insuficiente {nome}: {r:.2f}:1")
        linhas.append(f"contraste {nome}: {r:.2f}:1 {nivel}")

    # relatorio: acumula em `saida` para imprimir no console E gravar em build/audit.txt
    saida = []
    P = saida.append
    P("=" * 66)
    P("AUDITORIA ESTATICA - Barquin LP")
    P("=" * 66)
    for l in linhas:
        P("  . " + l)
    P("")
    P(f"  CTAs com data-wa: {n_wa}  |  imagens: {len(c.imgs)}  "
      f"|  ids: {len(c.ids)}  |  links externos: {len(set(c.links_ext))}")
    P(f"  arquivos locais referenciados: {len(set(c.locais))}  "
      f"|  inexistentes: {len(faltando)}")

    P("")
    P(f"PENDENCIAS BLOQUEANTES: {len(problemas)}")
    for p in problemas:
        P("  x " + p)
    P("")
    P(f"AVISOS (nao bloqueiam): {len(avisos)}")
    for a in avisos:
        P("  ! " + a)

    # tamanhos
    P("")
    P("TAMANHOS DE ENTREGA")
    P("-" * 66)
    alvos = ["index.html", os.path.join("css", "main.css"),
             os.path.join("css", "main.min.css"), os.path.join("js", "main.js")]
    pasta = os.path.join(ROOT, "assets")
    for sub in ("img", "icons"):
        d = os.path.join(pasta, sub)
        for n in sorted(os.listdir(d)):
            alvos.append(os.path.join("assets", sub, n))
    total = 0
    for rel in alvos:
        p = os.path.join(ROOT, rel)
        if os.path.exists(p):
            n = os.path.getsize(p)
            total += n
            P(f"  {rel.replace(os.sep, '/'):<44} {kb(n):>9}")
    P(f"  {'TOTAL pagina (index+css+js+assets)':<44} {kb(total):>9}")
    # peso da primeira visita
    primeira = (os.path.getsize(HTML)
                + os.path.getsize(css)
                + os.path.getsize(js)
                + os.path.getsize(os.path.join(pasta, "icons", "favicon.svg")))
    P(f"  {'1a visita (html+css+js+favicon)':<44} {kb(primeira):>9}")

    relatorio = "\n".join(saida) + "\n"
    print(relatorio, end="")
    destino = os.path.join(ROOT, "build", "audit.txt")
    with open(destino, "w", encoding="utf-8") as f:
        f.write(relatorio)
    print("relatorio completo gravado em build/audit.txt")
    return 1 if problemas else 0


def run_node_check(js):
    import subprocess
    p = subprocess.run(["node", "--check", js], capture_output=True, text=True)
    return p.returncode, (p.stdout or "") + (p.stderr or "")


def shutil_which(exe):
    from shutil import which
    return which(exe)


def lum(hexc):
    hexc = hexc.lstrip("#")
    c = [int(hexc[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    c = [x / 12.92 if x <= 0.03928 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


def contrast(fg, bg):
    a, b = lum(fg), lum(bg)
    hi, lo = max(a, b), min(a, b)
    return (hi + 0.05) / (lo + 0.05)


if __name__ == "__main__":
    sys.exit(main())
