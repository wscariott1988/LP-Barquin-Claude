# Ferramentas da landing page Barquin

Tudo roda local, sem dependência de framework e sem instalar nada no projeto.
Pré-requisitos: **Python 3**, **Node.js** e o pacote Python `playwright`
(usado só para medir layout e comportamento num Chromium real).

Todos os comandos devem ser executados a partir da raiz do projeto
(`LP Barquin - Espírito Santo`).

---

## O que está versionado (e o que não está)

O **código** desta pasta está no Git: `audit.py`, `build.py`, `make_assets.py`,
`serve.py`, `test_async.py`, `test_behavior.mjs`, `test_layout.mjs` e este
README — cerca de 90 KB. Assim, quem clona o repositório recebe também o
*como*: dá para regerar o favicon e o card de compartilhamento, rodar a
auditoria e os testes, e ver no histórico por que o CSS é gerado daquele jeito.

O que **não** entra, por decisão do `.gitignore`:

| Artefato | Por quê |
|---|---|
| `build/screenshots/` (3 MB) | capturas de tela das execuções |
| `build/REPORT.md` | relatório datado de uma entrega anterior; hoje já desatualizado |
| `build/audit.txt`, `build/layout-tests.json`, `build/behavior-tests.json` | saída das ferramentas |
| `build/index-async.html` | variante gerada do `index.html` |
| `assets/originals/` | fotos sem otimizar (fonte dos recortes) |

Consequência prática: quem clonou o repo **não** consegue regerar
`logo-barquin`, `badge-barquin` e `assinatura` (dependem das fotos originais),
mas consegue refazer `favicon.svg`, `favicon.ico`, `apple-touch-icon.png` e o
`og-barquin.jpg` com `--only icons,og`. O script avisa e segue em vez de
quebrar quando a pasta de originais não existe.

### Requisitos do ambiente

- **Windows**: `og-barquin.jpg` é desenhado com as fontes do sistema
  (`C:\Windows\Fonts\ariblk.ttf`, `arialbd.ttf`, `arial.ttf`). As três já
  existem em qualquer instalação do Windows.
- **Chrome**: os dois testes em Node procuram o Google Chrome em
  `CHROME_PATH`, `Program Files`, `Program Files (x86)` e `%LOCALAPPDATA%`.
  Se estiver em outro lugar:

  ```powershell
  $env:CHROME_PATH = "D:\Apps\Chrome\chrome.exe"
  node build\tools\test_layout.mjs
  ```

- `python` precisa de `pip install pillow playwright` (o `playwright install
  chromium` não é necessário aqui: os testes em Node usam o Chrome instalado).

---

## Ordem recomendada

```powershell
python build\tools\serve.py            # 1. sobe o servidor (deixe aberto)
python build\tools\build.py            # 2. gera o CSS e injeta no index.html
python build\tools\build.py --mode=async   # 2b. gera a variante assincrona
python build\tools\audit.py            # 3. auditoria estatica
node  build\tools\test_layout.mjs      # 4. layout responsivo + carrossel
node  build\tools\test_behavior.mjs    # 5. sem JS, medicao, CLS e LCP
python build\tools\test_async.py       # 6. checa a variante assincrona
```

Os testes 4, 5 e 6 precisam do servidor do passo 1 rodando.

---

## O que cada uma faz

### `serve.py`
Servidor estático na porta **8765** com os MIME types corretos.
Abrir <http://127.0.0.1:8765/> para ver a página.
Os ícones usam caminho absoluto de raiz (`/assets/icons/...`), então a página
precisa ser servida por HTTP — abrir o `index.html` com `file://` quebra os
ícones e o JavaScript.

### `build.py`
Gera `css/main.min.css` a partir de `css/main.css` e injeta o CSS no
`index.html` entre os marcadores:

```html
<!-- build:css-start -->
<!-- build:css-end -->
```

**Não edite o CSS dentro do `index.html`.** Edite `css/main.css` e rode o build.
O comando é idempotente: pode rodar quantas vezes quiser.

Dois modos de entrega do CSS:

| Modo | Comando | O que faz | CLS medido |
|---|---|---|---|
| `inline` (padrão) | `python build\tools\build.py` | CSS completo inline no `<head>` | **0,000** no Lighthouse; 0,005 sob throttling no desktop |
| `async` | `python build\tools\build.py --mode=async` | CSS externo com `preload`/`onload` + `<noscript>`, e critical CSS inline | 0,35 mobile / 0,77 desktop |

O modo `async` grava em `build/index-async.html` e **não** mexe no `index.html`.

**Por que o padrão é inline:** o briefing pedia CSS assíncrono, mas nesta página
(o documento é um scroll único, sem corte claro de "acima da dobra") o critical
CSS pequeno não segura o layout e o CLS fica ruim. O modo inline zera o CLS e
ainda entrega 100/100/100 no Lighthouse. A variante `async` continua disponível
e verificada, caso a decisão do cliente mude — os números estão no comentário do
próprio `build.py` e no relatório.

### `make_assets.py`
Gera os derivados visuais: WebP, PNG, OG 1200×630, favicon SVG/ICO e
apple-touch-icon. As fotos originais vêm de `assets/originals/`; os ícones e o
monograma "B" são **desenhados por código** (`geometria_b` / `draw_b_mask`), sem
depender de arquivo de origem. Só precisa rodar se alguma imagem mudar, ou para
ajustar a geometria do ícone:

```powershell
python build\tools\make_assets.py                     # tudo
python build\tools\make_assets.py --only icons,og     # so icones e OG
```

O `favicon.svg` é gerado a partir da mesma geometria do PNG, então os dois
renderizam exatamente o mesmo "B" (conferido comparando o SVG renderizado no
Chromium com o PNG, pixel a pixel).

### `audit.py`
Checagem estática, sem navegador: sintaxe do JS, chaves do CSS, contraste dos
pares de cor, contagem de CTAs, arquivos locais referenciados que não existem,
IDs e pendências. Sai com código 1 se houver pendência bloqueante.
Grava o relatório completo em `build/audit.txt`.

O contraste do texto sobre o laranja é lido do próprio `css/main.css`, então a
auditoria não passa a enforcear uma cor que o CSS já tenha abandonado.

### `test_layout.mjs`
Abre um Chromium real e mede **6 larguras**: 320, 375, 414, 768, 1024 e 1440 px.
Verifica overflow horizontal, allowlist das URLs dos 13 CTAs, alvos de toque
≥ 44 px, texto corrido ≥ 16 px, carregamento e `alt` das imagens, Presence de um
único `h1`, painel de privacidade e o carrossel (com uma fixture de 6 avaliações,
só no teste). Confere ainda que nenhum item do rodapé fique coberto pelo botão
flutuante do WhatsApp. Gera as capturas em `build/screenshots/` e o relatório
completo em `build/layout-tests.json`.

### `test_behavior.mjs`
Quatro blocos:
1. **Sem JavaScript** — desliga o script via CDP e confere que a página continua
   estilada e que os 13 CTAs seguem navegáveis.
2. **Medição** — Consent Mode negado por padrão, zero requisições a terceiros
   com os IDs vazios, e com IDs de teste confirma `config` do GA4/Ads e exatamente
   um evento `whatsapp_click` carregando a posição do CTA.
3. **Web vitals** — CLS e LCP em 375 e 1440 px.
4. Grava as falhas em `build/behavior-tests.json`.

### `test_async.py`
Verifica a variante `async` de verdade: copia `build/index-async.html` para a
raiz (para os caminhos relativos funcionarem), carrega, confere que o CSS
completo chegou, cores, grid, CTAs, overflow, requisições e console, mede o CLS
e apaga o arquivo temporário. Espera **2 falhas de CLS** — é o comportamento
conhecido e documentado desse modo.

---

## Resultados esperados

| Verificação | Resultado |
|---|---|
| `audit.py` pendências bloqueantes | 0 |
| `test_layout.mjs` falhas | 0 |
| `test_behavior.mjs` falhas | 0 |
| Lighthouse mobile | perf 100 · a11y 100 · boas práticas 100 · SEO 63 |
| Lighthouse desktop | perf 100 · a11y 100 · boas práticas 100 · SEO 63 |
| CLS (modo inline) | 0 |

O SEO 63 é **intenso**: a página está com `robots="noindex,nofollow"` por decisão
(só tráfego pago). É a única auditoria que reprova (`is-crawlable`). O
`robots.txt` já libera `facebookexternalhit` e `WhatsApp`, então a prévia não é
afetada. Se um dia a página precisar ser indexada, trocar para
`index,follow,max-image-preview:large` junto com o preenchimento dos IDs.

Os avisos não bloqueantes da auditoria são esperados: seção de avaliações ainda
sem textos transcritos, carrossel que só aparece com itens, e IDs de medição
vazios (por decisão, para não inventar dado).

---

## O que ainda depende de informação externa

Nada abaixo pode ser resolvido por código:

- **Domínio publicado** → o domínio já está em `canonical`/`og:url`
  (`https://barquin.grupows.com/`); falta só subir a página e revalidar a prévia.
- **IDs reais** de GA4 e Google Ads em `js/main.js` (hoje `null`).
- **As 6 avaliações reais** do perfil Google, para a seção `#avaliacoes`.
- **Foto real autorizada** de serviço, para substituir a hero tipográfica.
- **Aprovação visual** do logo, do badge e do ícone "B" pelo cliente.
