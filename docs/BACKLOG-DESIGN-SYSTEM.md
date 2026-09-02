# Backlog — Design System (`@assistente-os/ui`)

Backlog **gerenciável** dos itens deixados em aberto pelos sub-projetos A1
(fundação: tokens/`deriveTheme`/`ThemeProvider`) e A2a (primitivos) do
reposicionamento da superfície amigável. Todo item aqui veio de uma revisão de
código real (por tarefa ou de branch inteira) — não é especulação, é o que os
revisores encontraram e eu parkei deliberadamente em vez de consertar na hora,
com o porquê registrado.

Escopo: só o design system (`packages/ui`). Governança/spec fica em
[`BACKLOG-SPEC-COMPLIANCE.md`](BACKLOG-SPEC-COMPLIANCE.md); features do modo
amigável em [`BACKLOG-FRIENDLY-MODE.md`](BACKLOG-FRIENDLY-MODE.md).

---

## Como gerenciar

- **ID**: `DS<n>` — estável, use em branch/commit/PR.
- **Status**: `TODO` → `DOING` → `REVIEW` → `DONE` · ou `BLOCKED`.
- **Prioridade**: `P0` = bloqueia A2b/B agora · `P1` = vai doer na primeira
  semana de A2b/B se não resolvido · `P2` = qualidade/consistência, sem prazo ·
  `P3` = cosmético, faça quando mexer no arquivo de qualquer forma.

---

## Board

| ID | Item | Sub-projeto | Prio | Esforço | Status | Depende |
|---|---|---|---|---|---|---|
| DS1 | `ScrollArea` sem acesso ao Viewport (sem `viewportRef`/scrollbar horizontal) | A2a → A2b | P0 | S | TODO | — |
| DS2 | Notas operacionais do A1 nunca foram pro spec do B (bundler resolution, content glob, memoize de `brand`) | A1 → B | P1 | S | TODO | — |
| DS3 | `Field` não compõe com `Select` (só documentado, não resolvido de verdade) | A2a → A2b | P1 | M | TODO | — |
| DS4 | Testes de a11y faltando em Tabs/DropdownMenu/Switch/Checkbox (hoje verificados limpos, sem teste de regressão) | A2a | P2 | S | TODO | — |
| DS5 | `--accent`/`--chat-user-bubble` não são o "tint de baixo chroma" da spec A1 §3.4 | A1 → A2b | P2 | S–M | TODO | — |
| DS6 | Preset Tailwind sem fallback se `tokens.css` não for importado | A1 → B | P2 | S | TODO | — |
| DS7 | Limpeza cosmética em lote (ver item) | A2a | P3 | S | TODO | — |
| DS8 | Token `--overlay` pro scrim do Dialog (hoje usa `--foreground`, quebra no dark mode) | A1 → futuro dark mode | P3 | S | BLOCKED | dark mode nem existe ainda |
| DS9 | Reformular a Global Constraint de `forwardRef` no spec do A1 | A1 (doc) | P3 | S | TODO | — |

---

## Itens

### DS1 — `ScrollArea` sem Viewport exposto  ·  P0
**Objetivo**: `MessageList` (A2b, spec §4) precisa de `scrollTop`/`scrollHeight`/`onScroll` do Viewport interno pra fazer auto-scroll até o fim e mostrar "ir pra última" quando o usuário rola pra cima.
**Estado atual (verificado pela revisão final do A2a)**: `ScrollArea` (`packages/ui/src/components/scroll-area.tsx`) forwarda `ref` só pro `Root`; não expõe o `Viewport`. Único acesso hoje é `querySelector("[data-radix-scroll-area-viewport]")` — funciona (atributo confirmado presente no Radix 1.2.2 instalado) mas é gambiarra. Só renderiza `Scrollbar` vertical — conteúdo largo (bloco de código dentro de mensagem) não tem scrollbar nenhuma.
**Gap**: sem isso, A2b não consegue implementar o auto-scroll do jeito certo.
**Aceitação**:
- `ScrollArea` ganha prop `viewportRef?: React.Ref<HTMLDivElement>` (ou exporta `ScrollAreaViewport` separado).
- `Scrollbar` horizontal + `Corner` adicionados.
- Teste cobrindo o novo ref chegando no nó real do Viewport.
**Arquivos**: `packages/ui/src/components/scroll-area.tsx`.
**Por que não foi resolvido no A2a**: a revisão final separou explicitamente isso da lista "antes do merge" — é gap real mas de baixo risco de deixar pra quem for construir `MessageList`.

### DS2 — Notas do A1 nunca chegaram no spec do B  ·  P1
**Objetivo**: as recomendações que a revisão final do A1 fez especificamente para o B nunca foram conferidas linha a linha contra o spec do B que escrevi depois.
**Estado atual (verificado agora)**: o spec do B (`docs/superpowers/specs/2026-09-01-app-redesign-threads-streaming-design.md`) registra o TODO do error boundary do `ThemeProvider` (isso passou). **Não registra**: (a) `moduleResolution: "bundler"` é obrigatório no `tsconfig` do `packages/web` — o `exports` do `@assistente-os/ui` aponta pra um `.ts` sem campo `types`; (b) o glob de `content` do Tailwind tem que ser `./node_modules/@assistente-os/ui/src/**/*.{ts,tsx}` (já é o texto certo no preset depois do fix do A2a, mas o spec do B não repete o aviso); (c) memoizar a prop `brand` do `<ThemeProvider>` — um objeto literal inline re-deriva e reescreve as 8 vars a cada render.
**Gap**: quem implementar B vai descobrir isso do jeito difícil (bugs sutis) em vez de ler no spec.
**Aceitação**: adicionar uma subseção "Notas de integração herdadas do A1" no spec do B com os 3 pontos acima.
**Arquivos**: `docs/superpowers/specs/2026-09-01-app-redesign-threads-streaming-design.md`.

### DS3 — `Field` não compõe com `Select`  ·  P1
**Objetivo**: `SettingsPanel` (A2b) provavelmente quer um `Select` dentro de um `Field` (label + hint/erro), do mesmo jeito que já usa `Field` com `Input`.
**Estado atual (verificado)**: `Field.tsx` tem um comentário avisando que não funciona com `Select` (o `cloneElement` mira o `<Select>` root, que é só um provider de contexto do Radix sem nó DOM — os props injetados somem). `SelectTrigger` hoje exige `aria-label`/`aria-labelledby` próprio (fix do A2a), o que cobre a acessibilidade mas não a composição visual com `Field` (label/hint/erro consistentes).
**Gap**: sem isso, toda tela com um select rotulado (ex.: "Tier do modelo" no SettingsPanel) fica inconsistente com os outros campos do formulário.
**Aceitação**:
- `Field` ganha uma segunda forma de uso — render-prop ou `controlId`-exposing — que permita ao caller repassar `aria-labelledby` pro `SelectTrigger` sem depender de `cloneElement`.
- Story demonstrando `Field` + `Select` funcionando (label clicável, hint/erro visíveis).
**Arquivos**: `packages/ui/src/components/field.tsx`, `packages/ui/src/components/select.tsx`.
**Por que não foi resolvido no A2a**: é redesenho de verdade, não fix mecânico — a revisão final ofereceu isso como uma entre várias opções, arriscado demais pra uma única onda de fix já em andamento.

### DS4 — Testes de a11y faltando em 4 primitivos  ·  P2
**Objetivo**: `Tabs`, `DropdownMenu`, `Switch`, `Checkbox` não têm teste de regressão de acessibilidade — só foram verificados manualmente (via axe, uma vez, pela revisão final).
**Estado atual (verificado)**: `expectNoA11yViolations` só é chamado em `button.test.tsx`, `dialog.test.tsx`, `select.test.tsx`, `popover.test.tsx`, `toaster.test.tsx`. Os 4 citados passaram no axe quando testados manualmente na revisão final — mas uma mudança futura pode quebrar isso sem que nenhum teste avise.
**Aceitação**: um teste `expectNoA11yViolations` a mais em cada um dos 4 arquivos de teste.
**Arquivos**: `packages/ui/src/components/{tabs,dropdown-menu,switch,checkbox}.test.tsx`.

### DS5 — Rampa de accent/bolha de chat não é "baixo chroma"  ·  P2
**Objetivo**: spec do A1 §3.4 pede um tint de baixo chroma pro `--accent` e `--chat-user-bubble` (~passo 100 da rampa). Hoje sai ~7x mais saturado que o pretendido pra maioria das cores de marca.
**Estado atual (verificado pela revisão final do A1)**: `bellCurve(1) ≈ 0.647` no gerador de rampa — pra qualquer seed no teto de chroma, o accent sai em `0.95 0.1425 <hue>`, fora do gamut sRGB. AA continua passando (confirmado sob gamut-mapping de browser), então não é bug de acessibilidade — é fidelidade visual: `<ThemeProvider brand={null}>` e `<ThemeProvider brand={corDaCasa}>` renderizam accent visivelmente diferentes.
**Gap**: só fica visível de verdade quando A2b usar `--accent`/bolha de chat em componentes reais.
**Aceitação**: cap de chroma adicional pros passos claros da rampa (índices 0-2), restaurando a intenção do spec.
**Arquivos**: `packages/ui/src/theme/ramp.ts`, `packages/ui/src/theme/derive.ts`.

### DS6 — Preset sem fallback se `tokens.css` não for importado  ·  P2
**Objetivo**: se quem consome o pacote (B, E) esquecer de `import "@assistente-os/ui/tokens.css"`, toda cor vira `oklch( / 1)` — inválida, descartada pelo parser CSS, sem erro nenhum no console.
**Estado atual (verificado pela revisão final do A1)**: `color()` no preset gera `oklch(var(--x) / <alpha-value>)` sem valor de fallback.
**Aceitação**: `oklch(var(--x, <default>) / <alpha-value>)` — precisa decidir o valor de fallback pra cada var (provavelmente os mesmos valores de `tokens.css` `:root`, duplicados no preset).
**Arquivos**: `packages/ui/tailwind-preset.cjs`.
**Por que não foi resolvido**: muda o formato de toda cor do preset — risco maior que o resto da onda de fix do A1; parkeado deliberadamente pra quando B configurar de fato o import.

### DS7 — Limpeza cosmética em lote  ·  P3
Junta vários achados Minor das revisões (nenhum sozinho justifica uma tarefa):
- `CardTitle` força `<h3>` — precisa de `asChild` pra `AuthCard`/`SettingsPanel` poderem usar outro nível de heading.
- `Toaster` não aceita props — `duration`/`swipeDirection` do `ToastProvider` estão hardcoded.
- `DialogOverlay` e `ToastEntry` não estão no barrel (`index.ts`) — seriam úteis pro B restylizar o scrim / tipar estado de toast.
- Varredura de cor hardcoded (`no-hardcoded-color.test.ts`) é não-recursiva — só cobre `src/components/` no nível raiz; `src/hooks/`, `src/theme/`, e qualquer subpasta futura ficam sem guarda.
- Novas deps do `package.json` não estão em ordem alfabética.
**Arquivos**: vários, ver acima.

### DS8 — Token `--overlay` pro scrim do Dialog  ·  P3  ·  BLOCKED
**Objetivo**: `dialog.tsx` usa `bg-foreground/40` pro scrim atrás do modal. Hoje é correto (`--foreground` é quase-preto no tema claro), mas quando o dark mode existir `--foreground` vira quase-branco e o scrim vira um "lavado" branco em vez de escurecer o fundo.
**Bloqueado por**: dark mode não existe ainda (não estava no escopo do A1 nem do A2a — spec do A1 explicitamente não entrega tema escuro no v1).
**Aceitação**: token `--overlay` dedicado, independente de `--foreground`.
**Arquivos**: `packages/ui/src/tokens.css`, `packages/ui/src/components/dialog.tsx`.

### DS9 — Reformular a Global Constraint de `forwardRef`  ·  P3
**Objetivo**: o texto do spec do A1 diz "todo componente é um `forwardRef`" — a revisão final do A2a mostrou que isso é amplo demais: `Dialog`/`Popover`/`Select`/`DropdownMenu`/`Tooltip`/`Tabs` (as raízes) são re-exports de providers de contexto do Radix que não renderizam nó DOM nenhum — um `forwardRef` ali mentiria sobre o que existe.
**Aceitação**: reformular pra "todo componente que renderiza seu próprio elemento DOM é um `forwardRef`" no documento do spec.
**Arquivos**: `docs/superpowers/specs/2026-09-01-design-system-packages-ui-design.md`.
**Nota**: é só o texto do spec — o código já está certo (`DialogHeader`/`DialogFooter`/`Skeleton`/`Badge` poderiam ganhar `forwardRef` por uniformidade cosmética, mas nada depende disso).

---

## Observação — não é item de backlog, é pra vigiar

Sob a suíte completa (29 arquivos, todos rodando junto), os testes baseados em
Popper (`Tooltip`/`DropdownMenu`/`Select`/`Popover`) ficaram bem mais lentos
sob contenção de CPU do sandbox — `Popover` sozinho levou ~80s pros seus 2
testes numa rodada. Isolados, cada um roda em 20-25s (dentro da margem do
timeout de 60s). Vale medir numa máquina de CI de verdade antes de confiar
nesses tempos — pode precisar reduzir escopo dos testes ou paralelizar menos.

---

## Rastreio de mudança

| Data | Item | Evento |
|---|---|---|
| 2026-09-02 | — | Backlog criado a partir das revisões do A1 e A2a (final + por tarefa). |
