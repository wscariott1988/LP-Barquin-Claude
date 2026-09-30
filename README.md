# Barquin — Landing Page

Landing page da **Barquin**, serviço de montagem de móveis em Serra e região da Grande Vitória (ES).

## Sobre

Montagem e desmontagem de móveis, montagem corporativa, assistência, adaptação e corte, troca de corrediças e dobradiças, instalação de TV e ventilador de teto. Orçamento pelo WhatsApp.

## Estrutura

```
index.html          página única (todas as seções)
css/main.css        estilos (main.min.css é a versão minificada)
js/main.js          interações (carrossel, menu, formulários, analytics)
assets/icons/       favicon e ícones
assets/img/         logo, badges, assinatura, imagem de compartilhamento (OG)
```

## Desenvolvimento

Site estático, sem build step. Para abrir localmente:

```bash
python -m http.server 8000
```

A pasta `build/` (scripts de auditoria, testes de layout/comportamento e screenshots) e `assets/originals/` (fotos sem otimizar) não versionadas — veja `.gitignore`.

## Pré-publicação

Pendências documentadas no comentário do `<head>` de `index.html`:

1. Definir o domínio e preencher `canonical` e `og:url`.
2. Alterar `robots` de `noindex,nofollow` para `index,follow,max-image-preview:large`.
3. Preencher os IDs reais de GA4 e Google Ads em `js/main.js`.
4. Converter `og:image` em URL absoluta.
