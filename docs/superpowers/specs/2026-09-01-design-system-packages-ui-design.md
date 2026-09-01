# Design — `packages/ui` (design system para o reposicionamento)

**Data:** 2026-09-01
**Status:** proposto — aguardando revisão
**Sub-projeto:** A, do reposicionamento da superfície amigável (ver decomposição abaixo)

---

## Contexto

A superfície self-service ("modo amigável") hoje é HTML/CSS/JS puro servido
estático pelo daemon (`packages/daemon/web/friendly.html` + `assets/friendly.css`
+ `assets/friendly.js`). Funciona, mas é utilitária e não sustenta um
reposicionamento de produto.

Decidiu-se por um **redesign completo como reposicionamento**, com três
superfícies: (1) o app amigável redesenhado, (2) uma landing + onboarding público,
(3) white-label — **uma instância servindo várias marcas**, marca por conta/domínio.
Stack escolhida: **SPA React + Tailwind**, componentes shadcn-style, novo pacote.
Produção de design é **híbrida**: este projeto entrega a base do design system e a
estrutura; a exploração de telas específicas acontece no Google Stitch/Figma e é
conciliada de volta em tokens.

Como "uma instância, marca por conta/domínio" foi escolhido, o **isolamento
multi-tenant sólido vira pré-requisito** do white-label (sub-projeto C, abaixo) —
mas **não** deste sub-projeto A.

### Decomposição do reposicionamento

| # | Sub-projeto | Escopo | Depende de |
|---|---|---|---|
| **A** | **Design system** (`packages/ui`) | Tokens + componentes React/Tailwind temáveis; contrato `deriveTheme` | — |
| B | Redesign do app (`packages/web`) | SPA consumindo a API do daemon: auth, lista de assistentes, chat como conversa de verdade, configurações | A |
| C | Isolamento multi-tenant | `ownerAccountId` → coluna com FK, cobertura de rota, resolução de tenant por domínio, reconciliar `client_key` legado | — |
| D | Marca por conta + domínios custom | Storage de brand, admin, resolução host→tenant→`BrandInput` | A, C |
| E | Landing + onboarding público | Site de marketing (SEO → deploy próprio), signup como produto | A |

**Sequência:** A → (B ∥ C) → D → E. Cada sub-projeto tem seu próprio ciclo
spec → plano → implementação. **Este documento cobre só o A.**

### Não-objetivos do A

- Não redesenha telas concretas do app (isso é B) nem da landing (isso é E).
- Não implementa storage de brand, admin de marca nem resolução de domínio (isso é D).
- Não mexe no daemon, no `packages/daemon/web` atual, nem remove o HUD.
- Não entrega dark mode (tokens ficam prontos pra ele; tema não é shippado no v1).
- Não entrega visual regression testing (fica como adição futura).

---

## Visão geral da arquitetura

`packages/ui` é um **workspace package source-only**: entrega `.tsx`, `tokens.css`
e um preset Tailwind, sem build próprio além de `tsc` de tipos. Os consumidores
(`packages/web`, landing) rodam o Tailwind deles sobre o source do pacote.

Três camadas, com uma direção de dependência única:

```
tokens.css  (CSS custom properties — o contrato)
    ▲
    │  utilities do Tailwind mapeadas às vars (tailwind-preset.js)
    │
componentes  (primitivos shadcn + componentes de produto — nunca hardcodam cor)
    ▲
    │  import
    │
consumidores  (packages/web, landing)  ──chama──►  deriveTheme(BrandInput)
                                                        │
                                                        ▼
                                       escreve ~8 CSS vars em :root (override do tema padrão)
```

O **tema-produto padrão** vive inteiro em `tokens.css :root` e não precisa de
`deriveTheme`. `deriveTheme` só **sobrescreve** um punhado de vars a partir de um
seed de marca — essa é a garantia "mínimo curado", imposta no código.

---

## Componentes do sistema

### 1. Estrutura do pacote

```
packages/ui/
  package.json          # @assistente-os/ui · peerDeps: react, react-dom (>=19)
  tsconfig.json         # extends do base; noEmit exceto d.ts
  tailwind-preset.js    # consumidor: presets: [require('@assistente-os/ui/tailwind-preset')]
  postcss.config.cjs
  src/
    tokens.css          # camadas de token (primitivas + semânticas) do tema padrão
    theme/
      oklch.ts          # parse de cor, geração de rampa, checagem de contraste
      derive.ts         # deriveTheme(BrandInput) -> DerivedTheme
      types.ts          # BrandInput, DerivedTheme
      context.tsx       # <ThemeProvider>, useBrand() — expõe productName/logo aos componentes
    lib/
      cn.ts             # clsx + tailwind-merge
    components/
      button.tsx input.tsx textarea.tsx label.tsx field.tsx
      dialog.tsx dropdown-menu.tsx tabs.tsx toast.tsx tooltip.tsx popover.tsx
      scroll-area.tsx avatar.tsx skeleton.tsx separator.tsx switch.tsx
      checkbox.tsx select.tsx badge.tsx card.tsx
      app-shell.tsx brand-mark.tsx
      thread-list.tsx message-list.tsx message.tsx streaming-text.tsx
      markdown.tsx code-block.tsx citation.tsx composer.tsx empty-state.tsx
      auth-card.tsx settings-panel.tsx
      marketing/hero.tsx marketing/feature-grid.tsx marketing/cta-section.tsx
      marketing/nav.tsx marketing/footer.tsx   # stubs — detalhados na spec do E
    hooks/
      use-toast.ts
    index.ts            # barrel + subpath exports por componente
  catalog/
    *.stories.tsx       # Ladle — não publicado
  DESIGN.md             # linguagem visual decidida (preenchido no loop com Stitch)
```

- **Distribuição source-only.** `package.json` aponta `exports` para `./src/*`.
  Sem `dist` de JS. Os consumidores incluem `@assistente-os/ui/src/**/*.{ts,tsx}`
  no `content` glob do Tailwind — as classes são geradas no bundle do consumidor.
- **peerDeps:** `react`, `react-dom` (>=19). O pacote nunca embute React.
- **`react`/`react-dom`** entram como **devDep na raiz** (para type-check e Ladle) e
  como **dep real** em `packages/web` e na landing.

### 2. Arquitetura de tokens

`tokens.css` define, em `:root`, duas camadas em **OKLCH**:

**Camada 1 — escalas primitivas** (privadas; componentes não referenciam direto):
- `--brand-50 … --brand-950` — rampa de 11 passos (`50,100,…,900,950`) derivada do
  seed. No tema padrão, valores estáticos; `deriveTheme` só afeta os papéis
  semânticos, não a rampa (a rampa padrão fica em `tokens.css`; ver nota em §3).
- `--gray-50 … --gray-950` — escala neutra fixa.
- `--success/--warning/--danger/--info` (+ `-fg`) — hues de status fixos.
- `--text-xs … --text-4xl` — escala tipográfica, cada uma pareada com line-height
  (`--leading-xs` …).
- `--space-0 … --space-24` — base 4px.
- `--radius-sm/md/lg/xl/full`.
- `--shadow-xs/sm/md/lg/xl`.
- `--ease-standard/-emphasized`, `--dur-fast/-base/-slow`.

**Camada 2 — papéis semânticos** (o que os componentes usam):
- Conjunto exato do shadcn: `--background`, `--foreground`, `--card`,
  `--card-foreground`, `--popover`, `--popover-foreground`, `--primary`,
  `--primary-foreground`, `--secondary`, `--secondary-foreground`, `--muted`,
  `--muted-foreground`, `--accent`, `--accent-foreground`, `--destructive`,
  `--destructive-foreground`, `--border`, `--input`, `--ring`, `--radius`.
- Papéis de produto: `--chat-user-bubble`, `--chat-user-bubble-foreground`,
  `--chat-assistant-bubble`, `--chat-assistant-bubble-foreground`, `--citation`,
  `--citation-foreground`, `--code-bg`, `--code-fg`, `--sidebar`,
  `--sidebar-foreground`, `--sidebar-accent`.

**Camada 3 — nível de componente:** var local só onde um componente precisa de um
knob que nenhum papel cobre. Deve ser raro; cada uma é comentada com o porquê.

**Preset Tailwind** (`tailwind-preset.js`) mapeia:
- `colors.*` → `oklch(var(--<role>) / <alpha-value>)` para cada papel semântico.
- `fontSize.*` → `[var(--text-*), { lineHeight: var(--leading-*) }]`.
- `spacing.*`, `borderRadius.*`, `boxShadow.*`, `transitionTimingFunction.*`,
  `transitionDuration.*` → as vars correspondentes.
- Nada de cores cruas no preset — só referências a var.

**Regra imposta em teste (§6):** nenhum arquivo em `src/components/**` contém um
literal de cor (`#…`, `rgb(`, `hsl(`, `oklch(`). Cor só via classe Tailwind que
resolve pra var.

### 3. Contrato de tema + `deriveTheme`

```ts
// src/theme/types.ts
export interface BrandInput {
  productName: string;
  logo: { light: string; dark?: string };   // URL ou data URI; dark reservado p/ v2
  primaryColor: string;                       // qualquer cor CSS — o seed único
}

export interface DerivedTheme {
  /** Somente chaves da whitelist. Nunca mais que isso. */
  cssVars: Record<DerivedVarKey, string>;
  productName: string;
  logo: { light: string; dark?: string };
  /** Vars cujo valor teve de ser ajustado p/ passar AA — para log/telemetria. */
  nudged: DerivedVarKey[];
}

export type DerivedVarKey =
  | "--primary" | "--primary-foreground" | "--primary-hover"
  | "--ring" | "--accent" | "--accent-foreground"
  | "--chat-user-bubble" | "--chat-user-bubble-foreground";

export function deriveTheme(brand: BrandInput): DerivedTheme;
```

**Algoritmo** (`oklch.ts` + `derive.ts`):

1. **Parse.** `primaryColor` → OKLCH `(L, C, H)`. Suporta hex, `rgb()`, `hsl()`,
   `oklch()`, nomes CSS. Inparseável → `throw new InvalidBrandColorError(msg)`.
   O chamador trata: cai no tema padrão + reporta.
2. **Rampa.** 11 passos com lightness em alvos fixos
   `[0.98,0.95,0.90,0.82,0.72,0.62,0.54,0.46,0.38,0.30,0.22]`; chroma numa curva
   sino (pico ~passo 500, amortecido nas pontas — evita neon e barro), escalada
   pelo `C` do seed com teto; **hue mantido fixo** no v1.
3. **`--primary`.** Passo da rampa com contraste ≥ 4.5:1 contra `--background`
   (branco fixo do tema padrão) mais próximo do passo 600.
   **`--primary-foreground`** = branco ou `--gray-950`, o que passar AA contra
   `--primary`. **`--primary-hover`** = um passo mais escuro na rampa.
4. **`--ring`** = `--primary` com chroma reduzido. **`--accent` /
   `--accent-foreground`** = tint de baixo chroma (passo ~100) + seu fg AA.
   **`--chat-user-bubble` / `-foreground`** = passo ~100–200 + fg AA.
5. **Assert.** Todo par fg/bg emitido é checado por contraste. Falhou → nudge na
   lightness em passos de 0.02 até passar (máx N tentativas); esgotou → usa o
   default daquela var e adiciona a chave em `nudged`.
6. **Retorna** `cssVars` (só as 8 chaves), `productName`, `logo`, `nudged`.

**Nota sobre a rampa.** No v1, `deriveTheme` **não** re-emite `--brand-*` — só os 8
papéis. Se um consumidor futuro quiser a rampa inteira tematizada, é uma extensão
do contrato (mais chaves na whitelist), decidida à parte. Manter mínimo agora.

**`<ThemeProvider>` + `useBrand()`** (`theme/context.tsx`):
- `<ThemeProvider brand={BrandInput | null}>` — se `brand` for `null`, não faz
  nada (tema padrão). Se vier `BrandInput`, chama `deriveTheme` uma vez (memo) e
  escreve `cssVars` em `document.documentElement.style` via `useLayoutEffect`.
- Expõe `useBrand(): { productName, logo }` — `BrandMark` e textos de header
  consomem daqui. Sem `brand`, retorna os defaults do produto.

**Mecanismo de injeção** (documentado aqui, implementado por B/D/E):
- **App e landing:** no `<head>`, um `<script>` **inline bloqueante** lê
  `window.__BRAND__` (blob JSON injetado pelo servidor/edge por host) e escreve as
  vars antes do primeiro paint (anti-FOUC). O `<ThemeProvider>` no boot do React
  reconcilia com o mesmo `BrandInput` (idempotente).
- Sem `window.__BRAND__` (dev, ou host sem marca) → tema padrão.
- **Catálogo:** um global control do Ladle injeta `BrandInput` mock — 4 presets
  (padrão, quente, frio, quase-cinza). Toda story re-renderiza sob o seed
  selecionado.

### 4. Inventário de componentes

**Primitivos shadcn** — copiados pra `src/components/`, re-estilizados nos tokens,
comportamento Radix, variantes via `cva`:
`Button` (default/secondary/ghost/destructive/link × sm/md/lg), `Input`,
`Textarea`, `Label`, `Field` (wrapper: label + hint + erro + `aria-describedby`),
`Card`, `Dialog`, `DropdownMenu`, `Tabs`, `Toast` + `Toaster`, `Tooltip`,
`Popover`, `ScrollArea`, `Avatar`, `Skeleton`, `Separator`, `Switch`, `Checkbox`,
`Select`, `Badge`.

**Componentes de produto** — *o que faz · como se usa · do que depende*:

| Componente | O que faz | Como se usa | Depende de |
|---|---|---|---|
| `AppShell` | Frame de 3 zonas (sidebar / header / main), colapso responsivo da sidebar | `<AppShell sidebar={…} header={…}>{main}</AppShell>` | — |
| `BrandMark` | Logo + `productName` do contexto de marca; tamanhos `sm`/`md` | `<BrandMark size="md" />` | `useBrand()` |
| `ThreadList` / `ThreadListItem` | Lista de conversas: item ativo, ações (renomear/excluir) via menu, timestamp relativo | `<ThreadList items={…} activeId={…} onSelect onRename onDelete />` | `DropdownMenu`, `ScrollArea` |
| `MessageList` | Container rolável de turnos; auto-scroll ao fim; botão "ir pra última" quando desgrudado | `<MessageList>{messages.map(…)}</MessageList>` | `ScrollArea` |
| `Message` | Um turno, estilizado por `role`; slots: avatar, conteúdo, rodapé (citações, copiar, repetir) | `<Message role="assistant" footer={…}><Markdown …/></Message>` | `Markdown`, `Avatar` |
| `StreamingText` | Texto anexado em chunks com caret; tolera markdown parcial sem quebrar layout | `<StreamingText chunks={stream} />` | `Markdown` (modo incremental) |
| `Markdown` | Markdown → React seguro: GFM, links `rel=noopener` + host permitido, `[[n]]` → `Citation`, blocos → `CodeBlock` | `<Markdown source={md} citations={…} />` | `marked`, `dompurify`, `CodeBlock`, `Citation` |
| `CodeBlock` | Highlight + botão copiar + label de linguagem; highlighter lazy | `<CodeBlock lang="ts" code={…} />` | `shiki` (lazy) + fallback |
| `Citation` | Chip inline `[n]`; hover/click → `Popover` com título + trecho + link (porta o comportamento do `citations.js` atual) | `<Citation index={n} source={…} />` | `Popover` |
| `Composer` | Textarea que cresce, enviar, Enter/Shift-Enter, estado loading/disabled; slot de anexo reservado (FM1) | `<Composer onSubmit disabled={…} />` | `Textarea`, `Button` |
| `EmptyState` | Ícone + título + corpo + CTA opcional | `<EmptyState icon={…} title={…} action={…} />` | — |
| `AuthCard` | Shell login/signup com `Tabs`; slots de formulário; slot de erro | `<AuthCard login={…} signup={…} error={…} />` | `Tabs`, `Card`, `Field` |
| `SettingsPanel` | Layout de formulário seccionado pra dentro do `Dialog` de configurações | `<SettingsPanel sections={…} onSave />` | `Dialog`, `Field`, `Tabs` |
| `Hero` / `FeatureGrid` / `CTASection` / `Nav` / `Footer` | Primitivos da landing — **stubs no A** (assinatura + estilo base), detalhados na spec do E | — | `Button`, `BrandMark` |

`Toaster` + `useToast` é a superfície global de erro/confirmação. **O FM6
(mensagens de erro amigáveis) depende de `useToast` existir.**

**Ícones:** `lucide-react`, importados individualmente.

**Cortes YAGNI (v1):** sem data table, calendar, command palette, charts, date
picker, toggle de dark mode, carousel.

### 5. Catálogo + fluxo híbrido com Stitch

- **Ladle** em `packages/ui/catalog/`. `npm run catalog` (no pacote) serve local.
  Escolhido sobre Storybook por config quase-zero, Vite-native e footprint de dep
  menor.
- Uma `*.stories.tsx` por componente cobrindo **toda variante e estado**: default,
  loading, erro, vazio, conteúdo longo, overflow. As stories são a superfície de
  revisão visual e o checklist de QA manual.
- **Global control de brand** na toolbar do Ladle injeta `BrandInput` mock (4
  presets). Toda story re-renderiza sob o seed — é aqui que se valida se a rampa
  derivada aguenta marcas reais.
- **Loop híbrido:**
  1. Este projeto entrega tokens + primitivos + componentes de produto na **pele
     padrão** — sóbria, correta, acessível.
  2. O parceiro leva telas específicas (hero, onboarding, shell do chat) pro
     Stitch/Figma e explora direção visual.
  3. **Conciliação:** decisão **sistêmica** do Stitch (escala de tipo, passo de
     espaço, raio, profundidade de sombra, tratamento do hue) → edição de token em
     `tokens.css`, um lugar, propaga. Decisão de **uma tela** → vive no B/E.
  4. **Regra invariante:** Stitch influencia **valores de token e composição**,
     nunca o interior de componente. Comportamento novo pedido por uma tela = uma
     prop, discutida — não um fork.
- Saída do loop: `packages/ui/DESIGN.md` com a linguagem visual e o "porquê" dos
  valores de token.

### 6. Testes

Rodam no `npm test --workspaces` existente; `packages/ui` adiciona seu `test`
script (vitest + jsdom).

- **Contrato de token** (`theme/derive.test.ts`):
  - cor parseável entra → `cssVars` só tem chaves de `DerivedVarKey`;
  - todo par fg/bg emitido passa WCAG AA (contraste computado, asserido);
  - entrada inparseável → `throw InvalidBrandColorError`;
  - seeds conhecidos (fixtures) → snapshot estável de `cssVars`.
- **Derivação OKLCH** (`theme/oklch.test.ts`):
  - rampa monotônica decrescente em lightness;
  - chroma dentro dos limites da curva; hue mantido;
  - **fuzz de 200 seeds aleatórios** → AA nunca violado após nudge; `nudged`
    reportado quando houve ajuste.
- **Sem literal de cor nos componentes** (`no-hardcoded-color.test.ts`): varre
  `src/components/**/*.tsx`, falha se achar `#…` / `rgb(` / `hsl(` / `oklch(`.
- **Comportamento de componente** (vitest + `@testing-library/react` +
  `user-event`): contratos de interação apenas —
  `Dialog` prende foco e restaura no close; `DropdownMenu` navega por teclado;
  `Composer` Enter envia / Shift-Enter quebra linha; `StreamingText` anexa sem
  remontar; `Markdown` sanitiza (sem exec de `<script>`, sem HTML cru injetado);
  `Citation` abre `Popover` no click.
- **A11y smoke** (`axe-core`): a story default de cada componente renderiza com
  zero violação axe; o CI roda axe sobre todas as stories.
- **Sem visual regression** no v1 (Chromatic/Percy = infra + custo). Revisão
  manual via Ladle. Adição futura possível.

### 7. Deps novas + governança (ADR-UI-001)

`packages/ui` introduz, num repo cuja lista runtime inteira tem ~9 pacotes:

- **peer:** `react`, `react-dom` (>=19).
- **deps:** `@radix-ui/react-{dialog,dropdown-menu,tabs,tooltip,popover,
  scroll-area,avatar,switch,checkbox,select,separator,label,slot}` (~13, pequenos,
  tree-shakeable); `class-variance-authority`, `clsx`, `tailwind-merge`,
  `lucide-react`; `marked` + `dompurify`; `shiki` (lazy, só ~10 gramáticas) com
  fallback de highlighter leve.
- **dev:** `tailwindcss`, `postcss`, `autoprefixer`, `@ladle/react`, `vitest`,
  `@testing-library/react`, `@testing-library/user-event`, `jsdom`, `axe-core`,
  `@types/react`, `@types/react-dom`.

Isso é a reconciliação do STDLIB_FIRST que o **SPEC-HR5 já prevê**.

**ADR-UI-001** (`docs/adr/ADR-UI-001.md`), a escrever junto com a implementação:

- **Contexto:** o reposicionamento exige stack de UI real; a allowlist
  STDLIB_FIRST vigente é para o runtime do daemon/core/agente, não para um pacote
  de browser.
- **Decisão:** recortar `packages/ui`, `packages/web` e a landing como **zona de
  frontend explicitamente isenta**, com allowlist própria. `daemon`, `core`,
  `tools`, `memory`, `cli` mantêm o STDLIB_FIRST estrito **inalterado**.
- **Allowlist de frontend:** ecossistema React; Radix; toolchain Tailwind
  (`tailwindcss`/`postcss`/`autoprefixer`); `cva`/`clsx`/`tailwind-merge`; **um**
  parser markdown + **um** sanitizador; **um** highlighter; Ladle;
  vitest/testing-library/jsdom/axe-core. Adição nova a essa lista = emenda de uma
  linha no ADR.
- **Guard de CI:** o check de allowlist (`depcheck`/lista) passa a rodar **por
  zona** — lista estrita nos pacotes de backend, lista de frontend na zona de UI.
  Dep fora da lista da zona → CI vermelho.
- **Consequências:** bundle size vira métrica vigiada (budget check entra junto do
  SEO do E); superfície de supply-chain cresce — versões pinadas, `npm audit` no
  CI da zona de UI.
- **Fecha parte do SPEC-HR5:** atualiza o texto do `system_prompt`/spec para o
  modelo de duas zonas.

---

## Fluxo de dados

`deriveTheme` é a única lógica com "fluxo" no A; o resto é apresentação.

1. Servidor/edge resolve o host da requisição → `BrandInput | null` → serializa em
   `window.__BRAND__` no HTML. *(implementado em D; no A, mockado)*
2. `<script>` inline no `<head>` lê `window.__BRAND__`, chama uma versão mínima da
   derivação (ou lê `cssVars` pré-computadas se o servidor já derivou) e escreve
   em `documentElement.style` — antes do primeiro paint.
3. React monta; `<ThemeProvider brand={window.__BRAND__ ?? null}>` chama
   `deriveTheme` (memo), reconcilia as vars (idempotente) e popula o contexto.
4. Componentes leem cor via classe Tailwind → `var(--role)`; leem `productName` /
   `logo` via `useBrand()`.
5. Cor de marca inválida em qualquer ponto → `deriveTheme` lança → consumidor
   captura, fica no tema padrão, reporta (telemetria de D).

---

## Tratamento de erro

| Situação | Comportamento |
|---|---|
| `primaryColor` inparseável | `deriveTheme` lança `InvalidBrandColorError`; consumidor fica no tema padrão e loga |
| Par derivado não passa AA nem após nudge | usa o default daquela var; adiciona a chave em `nudged`; consumidor loga `nudged` |
| `window.__BRAND__` ausente / malformado | tema padrão, sem erro |
| `logo` 404 no browser | `BrandMark` cai para `productName` em texto |
| `Markdown` recebe HTML perigoso | `dompurify` remove; sem exec; sem warning ao usuário |
| Highlighter (`shiki`) falha ao carregar | `CodeBlock` renderiza texto plano monoespaçado |

---

## Plano de teste

- Unit/contrato: `theme/derive`, `theme/oklch`, `no-hardcoded-color` — ver §6.
- Comportamento: os contratos de interação de §6, por componente.
- A11y: axe sobre todas as stories no CI.
- Manual: varredura do catálogo Ladle sob os 4 presets de brand antes de fechar o
  sub-projeto.
- Integração fica com B (primeiro consumidor real): `packages/web` importa
  `@assistente-os/ui`, roda Tailwind sobre o source, renderiza uma tela real com
  tema padrão e com um `BrandInput` de teste.

---

## Esforço

- Estrutura do pacote + preset Tailwind + `tokens.css` (tema padrão): **M**
- `theme/` (oklch, derive, context) + testes de contrato: **M**
- Primitivos shadcn (20) re-estilizados + stories: **M–L**
- Componentes de produto (14) + stories + testes de comportamento: **L**
- Catálogo Ladle + presets de brand: **S**
- ADR-UI-001 + guard de CI por zona: **S–M**

Total do A: **L** (1–2 semanas), independente dos demais sub-projetos.

---

## Questões em aberto

- Highlighter definitivo: `shiki` lazy (melhor saída, ~heavier) vs
  `highlight.js`/`prismjs` lite. Decisão pode ficar para a implementação, medindo
  o bundle.
- Fonte do tema padrão: system stack vs uma família web (afeta o `<head>` e o
  DESIGN.md). Definir no loop com Stitch.
- `react` na raiz como devDep vs um `packages/ui` com seu próprio `node_modules`
  isolado — decisão de layout de workspace, na implementação.
