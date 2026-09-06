---
name: site-cloner
description: Extrai design tokens e inventario de componentes de uma URL com Playwright, gera um projeto Astro 4 + Tailwind semeado com os tokens e valida por diff de screenshots + testes funcionais. Use ao pedir clonar um site, replicar um layout ou extrair o design system de uma URL.
keywords: [site-cloner, clone visual, design system, design tokens, astro, tailwind, playwright, screenshot diff, pixelmatch, ssim, scaffold]
---

# Skill: site-cloner

## Visão geral

Pipeline em CLI que recebe uma URL de referência e:

1. **Analisa** a página com Playwright — extrai design tokens (cores, tipografia,
   spacing, radius, sombras, transições, z-index), um inventário hierárquico de
   componentes, as interações presentes (carousel, modal, countdown, accordion,
   tabs, dropdown, form, smooth-scroll) e screenshots baseline em 3 viewports.
2. **Gera** um projeto **Astro 4 + Tailwind CSS** semeado com esses tokens
   (`tailwind.config.ts` com `theme.extend`), componentes base e um layout
   scaffold, já com `npm install` + `astro build` rodados.
3. **Valida** o projeto gerado — comparação de screenshots (pixelmatch + SSIM,
   50/50) contra a referência e uma suíte funcional Playwright — e roda um
   **loop de correção** (até 5 iterações) que ajusta tokens/estilos para fechar
   os gaps.
4. Emite `validation-report.html` + JSONs com os scores.

## Expectativas realistas (leia antes de usar)

Esta skill **não reproduz o DOM/o conteúdo da referência verbatim**. O passo de
geração produz um **scaffold Astro+Tailwind alimentado pelos tokens e pelo
inventário extraído** — hero/seções/rodapé com estrutura genérica e texto
placeholder. Por isso:

- O gate visual de **≥90%** é uma **meta**, não uma garantia. Para landing pages
  simples e muito baseadas em tokens ele é alcançável; para sites densos em
  conteúdo, o loop de 5 iterações converge abaixo disso e o relatório lista os
  gaps para ajuste manual.
- O valor imediato e confiável está em: **design tokens prontos para Tailwind**,
  **mapa de componentes/interações**, **screenshots baseline** e o **harness de
  validação visual + funcional** reaproveitável.
- Trate o projeto gerado como ponto de partida a refinar, não como entrega final.

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
analyze-reference.ts   Playwright → design-tokens, component-map, interactions, screenshots/ (cache 24h por hash(url+viewports))
generate-project.ts    tokens → tailwind.config.ts; scaffold de componentes/layout/página; npm install + astro build
validate-visual.ts     sobe `astro preview`; screenshots nos 3 viewports; pixelmatch+SSIM full-page + recortes hero/header/cta
validate-functional.ts suíte Playwright (nav, forms, modais, carrosséis, responsivo, console, a11y básica)
iterate-fix.ts         prioriza os maiores gaps; ajusta tokens/estilos; re-valida; para em 5 iterações ou na convergência
```

## Saídas em `<output>/`

```
src/ public/                        projeto Astro 4 (+ node_modules/ e dist/ após o build)
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
| Visual hero / header | SSIM do recorte | ≥ 0.95 |
| Visual CTAs | SSIM do recorte | ≥ 0.93 |
| Visual mobile / tablet | SSIM full-page | ≥ 0.88 |
| Funcional (todos os testes) | pass/fail Playwright | 100% |
| Console | erros JS críticos | 0 |

Detalhe e metodologia em [references/validation-criteria.md](references/validation-criteria.md).
Guia de extração por tipo de site em [references/extraction-guide.md](references/extraction-guide.md).
Mapeamento CSS→Tailwind em [references/tailwind-mapping.md](references/tailwind-mapping.md).

## Limitações conhecidas

| Limitação | Mitigação |
|-----------|-----------|
| Geração é scaffold, não cópia de DOM | refino manual; use os tokens + o mapa de componentes |
| SPAs / JS pesado | `waitUntil: networkidle` + `document.fonts.ready` + buffer |
| Fontes licenciadas | extrai `font-family`; fallback Google Fonts + aviso |
| Animações JS (GSAP/ScrollTrigger) | `@keyframes` CSS → Tailwind; JS → stubs |
| Iframes cross-origin | screenshot separado, não comparado |
| SSIM é janela única (global) | aproximação — superavalia imagens estruturalmente distintas |

## Estrutura da skill

```
site-cloner/
├── SKILL.md
├── package.json  tsconfig.json
├── scripts/
│   ├── cli.ts                     entry point (commander)
│   ├── analyze-reference.ts       extração Playwright
│   ├── generate-project.ts        scaffold Astro + Tailwind + install/build
│   ├── validate-visual.ts         pixelmatch + SSIM
│   ├── validate-functional.ts     suíte funcional Playwright
│   ├── iterate-fix.ts             loop de correção (máx 5)
│   ├── commands/                  clone.ts  analyze.ts  validate.ts
│   └── utils/
│       ├── cache-manager.ts       cache 24h por hash(url+viewports)
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
