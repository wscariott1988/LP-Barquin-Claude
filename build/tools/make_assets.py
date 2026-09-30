"""
Gera os derivados de imagem da LP Barquin a partir dos originais em assets/originais/.
Nao altera os originais. Recorta apenas (sem distorcer o lettering).

Uso:  python build/tools/make_assets.py
      python build/tools/make_assets.py --only icons,og   # sem depender dos originais
"""

import os
import sys
from PIL import Image, ImageChops, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ORIG = os.path.join(ROOT, "assets", "originals")
IMG = os.path.join(ROOT, "assets", "img")
ICO = os.path.join(ROOT, "assets", "icons")

NAVY = (2, 30, 67)
ORANGE = (255, 107, 3)
SOFT = (252, 251, 251)
WHITE = (255, 255, 255)

# Retangulos medidos por analise de pixels dos originais (ver build/tools/README.md)
# CROP_LOGO: so o wordmark "BARQUIN" + a marca laranja.
# O arquivo original traz DEPOIS do wordmark uma linha de descritor
# ("Barquin Multiservicos") em y571-593, que foi cortada de proposito: a LP
# posiciona montagem de moveis, nao "multiservicos" generico (brief linha 30).
# A marca laranja e uma gota que desce ate y~590, entao o corte em 571 clica
# so a ponta da taper (~0,4% dos pixels laranja) -- conferido visualmente.
CROP_LOGO = (21, 180, 1509, 571)
# Assinatura "Excelencia em te servir" (laranja, script): x142-1390, y600-719
CROP_ASSINATURA = (142, 600, 1390, 720)
# Badge circular: x23-1230, y9-1243
CROP_BADGE = (23, 9, 1231, 1244)

FONT_BLACK = r"C:\Windows\Fonts\ariblk.ttf"
FONT_BOLD = r"C:\Windows\Fonts\arialbd.ttf"
FONT_REG = r"C:\Windows\Fonts\arial.ttf"


def crop_resize(src, box, width):
    im = Image.open(src).convert("RGB").crop(box)
    h = round(im.height * width / im.width)
    return im.resize((width, h), Image.LANCZOS)


def save_pair(im, base, quality=86, palette=0):
    png = os.path.join(IMG, base + ".png")
    webp = os.path.join(IMG, base + ".webp")
    if palette:
        # arte flat (2 cores + antialias): paleta reduz muito o fallback PNG
        q = im.quantize(colors=palette, method=Image.MEDIANCUT, dither=Image.FLOYDSTEINBERG)
        q.save(png, "PNG", optimize=True)
    else:
        im.save(png, "PNG", optimize=True)
    im.save(webp, "WEBP", quality=quality, method=6)
    return png, webp


def report(paths):
    total = 0
    for p in paths:
        s = os.path.getsize(p)
        total += s
        print(f"  {s/1024:8.1f} KB  {os.path.relpath(p, ROOT)}")
    print(f"  {total/1024:8.1f} KB  TOTAL")
    return total


# ---------------------------------------------------------------- identidade
# Proporcoes do monograma B. Ficam em UM lugar so porque alimentam a mascara
# PIL (favicon.ico / apple-touch-icon / card OG) e o favicon.svg: assim os dois
# nao podem divergir. `frame_ratio` e o respiro entre a moldura do B e o quadro.
FRAME_RATIO = 0.86
COR_QUADRADO = "#FFFFFF"


def geometria_b(moldura):
    """Medidas do B (navy) dentro de uma moldura quadrada de lado `moldura`."""
    altura = moldura * 0.88               # altura do B, centralizado
    topo = (moldura - altura) / 2
    return {
        "topo": topo,
        "meio": topo + altura / 2,         # linha onde as bocas se encontram
        "inf": topo + altura,
        "x0": moldura * 0.13,              # borda esquerda da haste
        "stem": moldura * 0.225,           # espessura da haste
        "x1": moldura * 0.89,              # borda direita das bocas
        "ry": altura / 4,                  # raio de cada boca
        "borda": moldura * 0.14,           # espessura da parede das bocas
    }


def draw_b_mask(size):
    """Monograma B geometrico: haste reta + duas bocas de mesmo raio.

    Desenhado com formas, e nao com fonte, para ficar nitido a 16 px: cada boca
    e um "estadio" (retangulo de canto totalmente arredondado) e os dois
    contadores usam o mesmo raio, entao o B nao engorda nem afina em nenhum
    tamanho. Subamostra em 8x e reduz com LANCZOS, como as demais artes.
    A moldura de size pixels ja e a area visivel do monograma, entao quem
    chama decide o respiro em relacao a ela.
    """
    s = size * 8  # supersample
    img = Image.new("L", (s, s), 0)
    d = ImageDraw.Draw(img)
    g = geometria_b(s)

    lx = g["x0"] + g["stem"]   # as bocas comecam na lateral da haste
    ri = g["ry"] - g["borda"]  # raio dos contadores
    bocas = ((g["topo"], g["meio"]), (g["meio"], g["inf"]))
    # silhueta: haste + duas bocas. Cada boca e um "D" — parte reta ate o eixo
    # do arco e semicirculo na direita. Desenhar assim (e nao com
    # rounded_rectangle) e o que da o ombro reto do B: o PIL arredondaria
    # tambem as pontas da esquerda e abriria um vao entre a haste e a boca.
    d.rectangle([g["x0"], g["topo"], g["x0"] + g["stem"], g["inf"]], fill=255)
    for y_a, y_b in bocas:
        d.rectangle([lx, y_a, g["x1"] - g["ry"], y_b], fill=255)
        d.ellipse([g["x1"] - 2 * g["ry"], y_a, g["x1"], y_b], fill=255)
    # contadores vazados: comecam na haste (nao a mordem) e param antes da borda
    for y_a, y_b in bocas:
        t, b = y_a + g["borda"], y_b - g["borda"]
        d.rectangle([lx, t, g["x1"] - g["borda"] - ri, b], fill=0)
        d.ellipse([g["x1"] - g["borda"] - 2 * ri, t, g["x1"] - g["borda"], b], fill=0)
    return img.resize((size, size), Image.LANCZOS)


def _reduzir(img, tamanho):
    """Reduz com LANCZOS sem criar franja escura na borda.

    O resize comum de um RGBA mistura o RGB *preto* dos pixels transparentes
    (os cantos arredondados) com a cor do glifo e deixa um halo escuro em volta
    do icone. Aqui o RGB e reduzido sobre fundo branco e o alpha vai separado:
    os cantos continuam transparentes, sem halo.
    """
    alpha = img.getchannel("A").resize((tamanho, tamanho), Image.LANCZOS)
    branco = Image.new("RGBA", img.size, WHITE + (255,))
    rgb = Image.alpha_composite(branco, img).convert("RGB")
    saida = rgb.resize((tamanho, tamanho), Image.LANCZOS).convert("RGBA")
    saida.putalpha(alpha)
    return saida


def monograma_b(tamanho, opaco=False, radius_ratio=0.22):
    """Quadrado arredondado branco com o B navy da marca.

    O B e recortado pela propria mascara do quadrado (multiplica os dois
    canais alpha), entao o canto do glifo acompanha o arco em vez de invadir o
    canto arredondado. `opaco=True` desliga o arredondamento e a transparencia:
    e o formato do apple-touch-icon, que o iOS arredonda sozinho.
    """
    s = tamanho * 8  # supersample
    quadrado = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    ImageDraw.Draw(quadrado).rounded_rectangle(
        [0, 0, s - 1, s - 1], radius=0 if opaco else s * radius_ratio, fill=WHITE + (255,)
    )
    mascara = draw_b_mask(int(s * FRAME_RATIO))
    alpha_b = Image.new("L", (s, s), 0)
    off = (s - mascara.size[0]) // 2
    alpha_b.paste(mascara, (off, off))
    alpha_b = ImageChops.multiply(alpha_b, quadrado.getchannel("A"))
    azul = Image.new("RGBA", (s, s), NAVY + (255,))
    azul.putalpha(alpha_b)
    quadrado.alpha_composite(azul)
    saida = _reduzir(quadrado, tamanho)
    if opaco:
        saida.putalpha(255)
    return saida


def favicon_svg():
    """favicon.svg montado da MESMA geometria da mascara PIL.

    Gerar o arquivo em vez de escribir o path a mao e o que garante que o
    icone vectorial e os PNG/ICO sejam o mesmo desenho.
    """
    V = 32
    moldura = V * FRAME_RATIO
    off = (V - moldura) / 2
    g = geometria_b(moldura)
    lx, ry, borda = g["x0"] + g["stem"], g["ry"], g["borda"]
    cx = g["x1"] - ry               # centro do arco de cada boca
    ri = ry - borda                 # raio dos contadores

    def n(v):
        return ("%.2f" % v).rstrip("0").rstrip(".")

    def X(v):
        return n(v + off)

    def Y(v):
        return n(v + off)

    partes = [
        # haste
        "M%s %sH%sV%sH%sZ" % (X(g["x0"]), Y(g["topo"]), X(g["x0"] + g["stem"]),
                              Y(g["inf"]), X(g["x0"])),
    ]
    for y_a, y_b in ((g["topo"], g["meio"]), (g["meio"], g["inf"])):
        # boca: reta ate o arco e volta, boiando para a direita
        partes.append("M%s %sH%sA%s %s 0 0 1 %s %sH%sZ" % (
            X(lx), Y(y_a), X(cx), n(ry), n(ry), X(cx), Y(y_b), X(lx)))
    for y_a, y_b in ((g["topo"] + borda, g["meio"] - borda),
                     (g["meio"] + borda, g["inf"] - borda)):
        # contador: subtrai, porque o fill e evenodd
        partes.append("M%s %sH%sA%s %s 0 0 1 %s %sH%sZ" % (
            X(lx), Y(y_a), X(cx), n(ri), n(ri), X(cx), Y(y_b), X(lx)))

    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" aria-label="Barquin">\n'
        '  <rect width="32" height="32" rx="7" fill="%s"/>\n'
        '  <!-- B geometrico navy: mesma geometria de build/tools/make_assets.py -->\n'
        '  <path fill="%s" fill-rule="evenodd" d="%s"/>\n'
        '</svg>\n'
    ) % (COR_QUADRADO, "#%02X%02X%02X" % NAVY, "".join(partes))


def build_icons():
    print("icones")
    paths = []
    # apple-touch-icon: quadrado opaco — o iOS aplica a propria mascara
    p = os.path.join(ICO, "apple-touch-icon.png")
    monograma_b(180, opaco=True).save(p, "PNG", optimize=True)
    paths.append(p)
    # ICO multi-resolucao 16/32/48
    ico_sizes = [16, 32, 48]
    frames = [monograma_b(s).convert("RGBA") for s in ico_sizes]
    p = os.path.join(ICO, "favicon.ico")
    frames[0].save(
        p, "ICO", sizes=[(s, s) for s in ico_sizes], append_images=frames[1:], bitmap_format="png"
    )
    paths.append(p)
    # SVG: gerado da mesma geometria, para nao divergir dos PNG/ICO
    p = os.path.join(ICO, "favicon.svg")
    with open(p, "w", encoding="utf-8", newline="\n") as f:
        f.write(favicon_svg())
    paths.append(p)
    report(paths)


# -------------------------------------------------------------------derivados
def build_images():
    print("derivados de logo")
    src_logo = os.path.join(ORIG, "IMG_0118.PNG")
    src_badge = os.path.join(ORIG, "IMG_0116.PNG")
    paths = []

    logo = crop_resize(src_logo, CROP_LOGO, 600)
    paths += list(save_pair(logo, "logo-barquin", palette=48))

    assinatura = crop_resize(src_logo, CROP_ASSINATURA, 760)
    paths += list(save_pair(assinatura, "assinatura", palette=32))

    badge = crop_resize(src_badge, CROP_BADGE, 260)
    paths += list(save_pair(badge, "badge-barquin"))

    report(paths)


# ------------------------------------------------------------------------ OG
def wrap(draw, text, font, max_w):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if draw.textlength(t, font=font) <= max_w:
            cur = t
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def build_og():
    print("og-barquin.jpg")
    W, H = 1200, 630
    img = Image.new("RGB", (W, H), NAVY)

    # detalhe grafico: anel laranja discreto escaping pela direita
    ring = Image.new("L", (W * 2, H * 2), 0)
    ImageDraw.Draw(ring).ellipse(
        [W * 2 - 1180, H * 2 - 1180, W * 2 + 620, H * 2 + 620], outline=255, width=54
    )
    ring = ring.resize((W, H), Image.LANCZOS).filter(ImageFilter.GaussianBlur(1))
    img.paste(Image.new("RGB", (W, H), ORANGE), (0, 0), ring.point(lambda v: int(v * 0.28)))

    d = ImageDraw.Draw(img)

    # cartao branco com a logo horizontal real
    d.rounded_rectangle((72, 60, 72 + 520, 60 + 172), radius=22, fill=WHITE)
    logo = Image.open(os.path.join(IMG, "logo-barquin.png")).convert("RGB")
    lw = 448
    lh = round(logo.height * lw / logo.width)
    logo = logo.resize((lw, lh), Image.LANCZOS)
    img.paste(logo, (72 + (520 - lw) // 2, 60 + (172 - lh) // 2))

    f_h = ImageFont.truetype(FONT_BLACK, 70)
    f_sub = ImageFont.truetype(FONT_BOLD, 32)
    f_tag = ImageFont.truetype(FONT_REG, 30)

    x, y = 72, 288
    for line in ("Montagem de móveis", "em Serra e", "Grande Vitória"):
        d.text((x, y), line, font=f_h, fill=WHITE)
        y += 78

    d.rectangle([x, y + 12, x + 104, y + 21], fill=ORANGE)
    d.text((x, y + 74), "Orçamento pelo WhatsApp", font=f_sub, fill=ORANGE, anchor="ls")
    d.text(
        (x + d.textlength("Orçamento pelo WhatsApp   ", font=f_sub), y + 74),
        "(27) 99780-6250",
        font=f_tag,
        fill=(198, 210, 228),
        anchor="ls",
    )

    # monograma no canto inferior direito: o B e navy, entao vai no mesmo
    # quadrado claro do favicon — sobre o fundo navy do card ele sumiria.
    qs = 168
    marca = monograma_b(qs)
    img.paste(marca, (W - qs - 72, H - qs - 64), marca)

    out = os.path.join(IMG, "og-barquin.jpg")
    img.save(out, "JPEG", quality=88, optimize=True, progressive=True)
    report([out])


if __name__ == "__main__":
    os.makedirs(IMG, exist_ok=True)
    os.makedirs(ICO, exist_ok=True)
    # --only icons,og roda so o que nao depende das fotos de assets/originals/,
    # que e o caso de quem so quer regerar o favicon e o card de compartilhamento.
    if "--only" in sys.argv:
        alvo = [p.strip() for p in sys.argv[sys.argv.index("--only") + 1].split(",")]
    else:
        alvo = ["images", "icons", "og"]

    if "images" in alvo:
        # assets/originals/ nao e versionado (sao fotos pesadas). Sem elas,
        # quem clonou o repo ainda consegue refazer favicon e OG -- que sao os
        # derivados que affectam a previa de link -- so nao os recortes das fotos.
        if os.path.isdir(ORIG) and os.listdir(ORIG):
            build_images()
        else:
            print("pulei 'images': %s nao existe (fotos originais nao sao "
                  "versionadas). Para regerar os derivados das fotos, coloque "
                  "as imagens nessa pasta." % os.path.relpath(ORIG, ROOT))
    if "icons" in alvo:
        build_icons()
    if "og" in alvo:
        build_og()
    print("ok")
