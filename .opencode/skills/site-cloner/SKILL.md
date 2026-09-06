---
name: site-cloner
description: Captura DOM + CSS + assets de uma URL com Playwright e gera um projeto Astro 4 que reproduz a pagina, mais design tokens para Tailwind, e valida por diff de screenshots + testes funcionais. Use ao pedir clonar um site, replicar um layout ou extrair o design system de uma URL.
keywords: [site-cloner, clone visual, snapshot, design system, design tokens, astro, tailwind, playwright, screenshot diff, pixelmatch, ssim]
---

# Skill: site-cloner

## Visão geral

Pipeline em CLI que recebe uma URL de referência e:

1. **Analisa** a página com Playwright — extrai design tokens (cores, tipografia,
   spacing, radius, sombras, transições, z-index), um inventário hierárquico de
   componentes, as interações presentes (carousel, modal, countdown, accordion,
   tabs, dropdown, form, smooth-scroll), screenshots baseline em 3 viewports e
   um **snapshot autossuficiente**: DOM renderizado + todo o CSS (inclusive
   folhas de CDN, re-buscadas server-side) + imagens/fontes baixadas para
   `public/assets/`, com URLs reescritas.
2. **Gera** um projeto **Astro 4**. Com snapshot, `index.astro` reproduz o
   `<body>` real da referência com o CSS capturado (`set:html`); sem snapshot,
   cai num scaffold semeado pelos tokens. Sempre emite `tailwind.config.ts`
   (`theme.extend` com os tokens), roda `npm install` + `astro build`.
3. **Valida** o projeto gerado — screenshots nos 3 viewports vs. referência
   (pixelmatch + SSIM 50/50), recortes hero/header/cta quando ambos os lados
   expõem o landmark, e uma suíte funcional Playwright — com **loop de correção**
   (até 5 iterações).
4. Emite `validation-report.html` + JSONs com os scores.

## Expectativas realistas (leia antes de usar)

- **Com snapshot** (caso normal) a reprodução é fiel: mesmo DOM, mesmo CSS,
  mesmos assets. É um **clone visual estático — sem JavaScript**: carrosséis,
  modais, contadores e menus não *funcionam*, só aparecem no estado capturado.
- **Similaridade visual típica: ~80–90%** para um template real denso. O que
  segura abaixo de 100%: SSIM de janela única (aproximação), diferenças de
  timing/animação entre as duas renderizações, e sub-pixel de scrollbar/altura.
  O gate `≥90%` é meta, não garantia — o relatório lista os gaps.
- Recortes **hero/cta** ficam `n/a` quando o template não expõe um landmark
  semântico correspondente nos dois lados; isso **não** reprova o gate (só conta
  o que foi medido de fato).
- Sem snapshot (falha de captura), o fallback é o scaffold por tokens — aí a
  similaridade cai bastante e o projeto é só um ponto de partida.
- Entregáveis sempre confiáveis: **tokens prontos para Tailwind**, **mapa de
  componentes/interações**, **screenshots baseline**, **assets locais** e o
  **harness de validação** reaproveitável.

## Quando usar

- "Clone este site: https://exemplo.com" / "replique o layout de <URL>"
- "Extraia o design system / os tokens de <URL>"
- "Quero um projeto Astro partindo do visual de <URL>"
- Qualquer pedido de bootstrap de projeto a partir de uma referência visual.

## Parâmetros fixos

| Parâmetro | Valor | Motivo |
|-----------|-------|--------|
| Framework | Astro 4 | SSG, ilhas de interatividade |
| Styling | Tailwind CSS | tokens diretos em `theme.extend` |
| Score visual | pixelmatch + SSIM, média 50/50 | pixel + perceptual |
| Viewports | 375 / 768 / 1440 px | mobile / tablet / desktop |
| Máx. iterações | 5 | tempo × convergência |
| Deploy | fora de escopo | só gera código |

## Interface CLI

```bash
site-cloner clone <url>       # analyze → generate → validate → iterate → report
site-cloner analyze <url>     # só a extração (tokens, componentes, screenshots)
site-cloner validate <dir>    # revalida um projeto já gerado
```

Opções de `clone` (ver `--help` para a lista completa):

```
-o, --output <dir>          saída (default ./cloned-site)
-c, --content-mapping <json> mapa seletor→texto: '{"h1":"Meu Título"}'
-t, --threshold <n>         threshold visual overall (default 0.90)
-i, --max-iterations <n>    default 5
-v, --viewports <lista>     default mobile,tablet,desktop
    --headless <bool>       default true
-r, --report <path>         default <output>/validation-report.html
    --cache-dir <dir>       default <skill>/.cache/site-cloner
-f, --force-fresh           ignora o cache de análise
    --verbose
```

Variáveis de ambiente:

- `SITE_CLONER_NO_INSTALL=1` — não roda `npm install`/`build` no projeto gerado
  (offline, ou quando quem chama vai montar o projeto).
- `SITE_CLONER_LIVE=1` — habilita o teste de extração ao vivo em `npm test`.

## Fluxo de execução

```
analyze-reference.ts   Playwright → design-tokens, component-map, interactions, screenshots/, snapshot/ (cache 24h por hash(url+viewports))
utils/snapshot.ts      coleta DOM + CSS (folhas de CDN re-buscadas server-side) + baixa assets → public/assets, reescreve URLs
generate-project.ts    snapshot → index.astro fiel (set:html) | fallback scaffold; tailwind.config.ts; npm install + astro build
validate-visual.ts     sobe `astro preview` (mata o processo no fim); screenshots nos 3 viewports; pixelmatch+SSIM full-page + recortes
validate-functional.ts suíte Playwright (nav, forms, modais, carrosséis, responsivo, console, a11y básica)
iterate-fix.ts         prioriza os maiores gaps; ajusta tokens/estilos; re-valida; para em 5 iterações ou na convergência
```

## Saídas em `<output>/`

```
src/ public/                        projeto Astro 4 (+ node_modules/ e dist/ após o build)
src/snapshot/                       body.html + captured.css (a página reproduzida)
public/assets/                      imagens/fontes baixadas da referência
tailwind.config.ts                  design tokens extraídos
validation-report.html              relatório visual + funcional
visual-validation-report.json       scores por viewport/recorte
functional-validation-report.json   resultado dos testes funcionais
visual-diffs/                       PNGs de diferença (pixelmatch)
README.md                           guia de personalização
```

## Critérios de validação

| Categoria | Métrica | Threshold |
|-----------|---------|-----------|
| Visual overall (desktop full-page) | pixelmatch + SSIM | ≥ 0.90 |
| Visual hero / header | SSIM do recorte | ≥ 0.95 quando medido (senão `n/a`) |
| Visual CTAs | SSIM do recorte | ≥ 0.93 quando medido (senão `n/a`) |
| Visual mobile / tablet | SSIM full-page | ≥ 0.88 |
| Funcional (todos os testes) | pass/fail Playwright | 100% |
| Console | erros JS críticos | 0 |

Um recorte sem landmark correspondente nos dois lados entra como `n/a` e **não**
reprova o gate — só conta o que foi de fato comparado.

Detalhe e metodologia em [references/validation-criteria.md](references/validation-criteria.md).
Guia de extração por tipo de site em [references/extraction-guide.md](references/extraction-guide.md).
Mapeamento CSS→Tailwind em [references/tailwind-mapping.md](references/tailwind-mapping.md).

## Limitações conhecidas

| Limitação | Mitigação |
|-----------|-----------|
| Clone estático — sem JS | carrosséis/modais/contadores só no estado capturado; re-anime à mão |
| SPAs / JS pesado | captura o DOM já hidratado (`networkidle` + `fonts.ready` + scroll-nudge) |
| `@import` aninhado em CSS | não seguido — só folhas de 1º nível e `<style>` |
| CSS/asset com CORS estrito no servidor de origem | re-busca server-side (`context.request`); se o host bloquear IP, o asset é pulado |
| Iframes cross-origin | não capturados |
| SSIM é janela única (global) | aproximação — teto realista ~90–95% mesmo em render idêntico |
| Fallback scaffold (sem snapshot) | similaridade baixa; tratar como ponto de partida |

## Estrutura da skill

```
site-cloner/
├── SKILL.md
├── package.json  tsconfig.json
├── scripts/
│   ├── cli.ts                     entry point (commander)
│   ├── analyze-reference.ts       extração Playwright + snapshot
│   ├── generate-project.ts        página fiel (snapshot) ou scaffold + install/build
│   ├── validate-visual.ts         pixelmatch + SSIM; dono do `astro preview`
│   ├── validate-functional.ts     suíte funcional Playwright
│   ├── iterate-fix.ts             loop de correção (máx 5)
│   ├── commands/                  clone.ts  analyze.ts  validate.ts
│   └── utils/
│       ├── cache-manager.ts       cache 24h por hash(url+viewports)
│       ├── snapshot.ts            DOM + CSS + assets → bundle autossuficiente
│       ├── token-extractor.ts     CSS computado → design tokens
│       ├── component-mapper.ts    DOM → árvore de componentes
│       └── pixel-diff.ts          pixelmatch + SSIM + PNG de diff
├── references/
│   ├── extraction-guide.md  tailwind-mapping.md  validation-criteria.md
│   └── astro-templates/           9 componentes base (Button, Card, Section,
│                                  Container, Grid, Badge, Input, Modal, Footer)
├── templates/                     *.hbs (package.json, astro.config, tsconfig, README)
└── evals/
    ├── evals.json                 3 casos (Event Go, Stripe, Vercel)
    └── evals.test.ts              schema sempre; extração ao vivo com SITE_CLONER_LIVE=1
```

## Dependências

`playwright` (browser + screenshots + testes), `pixelmatch` + `pngjs` +
`sharp` (diff visual), `css-tree` / `postcss` (parse CSS), `handlebars`
(templates), `astro` (`astro preview` na validação), `commander` / `chalk` /
`ora` (CLI).

## Build e teste

```bash
npm install
npx playwright install chromium
npm run typecheck   # tsc --noEmit
npm run build       # tsc → dist/
npm test            # vitest — schema dos evals (offline)
SITE_CLONER_LIVE=1 npm test   # + extração ao vivo contra a 1ª referência
```
