# Grafo de conhecimento visual no HUD

Substitui as três listas de texto da aba **GRAFO** (`tab-hud`) por um grafo de
nós/arestas navegável (arrastar, zoom, clique). Não mexe em backend — reaproveita
100% do endpoint que já existe.

## Diagnóstico (por que isso é um gap, não uma feature nova)

A aba **GRAFO** hoje renderiza `g.entities`/`g.relations`/`g.observations`
(`packages/daemon/web/assets/app.js::loadGraph`, linha ~601) como três `<ul>` de
texto — nenhum nó, nenhuma aresta, nenhum canvas. É busca estruturada com nome
de grafo.

A aba **LANGGRAPH** é diferente do que parece à primeira vista: **já tem**
highlight de nó ativo em tempo real (`renderLangGraphStep` → `lgActiveNode` →
`renderLangGraphSvg(mode, activeNode)`, linha ~782) — isso funciona. O gap ali é
só visual: topologia com coordenadas hardcoded (`LG_GRAPH_TOPOLOGIES`), cores
fixas (`#22c55e`/`#9ca3af`) que não usam a paleta neon do resto do HUD
(`--neon-*` em `app.css`), sem zoom/pan. Por isso o escopo abaixo é só a aba
GRAFO — a LANGGRAPH fica como fase 2 opcional em "Fora de escopo".

## Design

**Biblioteca:** `vis-network` via CDN (`unpkg.com/vis-network`), mesmo padrão
já usado nesta página pro QR code (`cdn.jsdelivr.net/npm/qrcodejs`, linha 16 de
`index.html`) — `<script src="...">` direto, sem bundler, sem entrar no
`package.json`. **Não precisa passar pelo gate `deps-zones`** (`.github/scripts/deps-zones.mjs`)
porque esse gate audita dependências npm declaradas, e isso nunca vira uma.

**Sem migração, sem rota nova.** `GET /souls/:id/graph` já devolve
`{ entities: [{kind, name}], relations: [{from, rel, to}], observations: [...] }`
— o mesmo payload que já popula as listas hoje. O grafo consome exatamente isso.

**Mapeamento pra `vis.DataSet`:**

```js
// packages/daemon/web/assets/app.js
function buildGraphDatasets(g) {
  const nodes = g.entities.map((en) => ({
    id: en.name,              // nome já é único dentro da soul (chave natural)
    label: en.name.length > 24 ? en.name.slice(0, 22) + "…" : en.name,
    group: en.kind.toLowerCase(),
  }));
  const edges = g.relations
    .filter((r) => nodes.some((n) => n.id === r.from) && nodes.some((n) => n.id === r.to))
    .map((r) => ({ from: r.from, to: r.to, label: r.rel, arrows: "to" }));
  return { nodes: new vis.DataSet(nodes), edges: new vis.DataSet(edges) };
}
```

O `filter` na montagem de `edges` existe porque `g.relations` pode citar uma
entidade fora do filtro atual (`entities_q`/`entities_kind`) — sem isso o
vis-network levanta erro de nó inexistente.

**Cores por `kind`** (usar `--neon-*` já definidas em `app.css`, não paleta
genérica):

| `kind` | Cor | Var CSS |
|---|---|---|
| `organization` | ciano | `--neon-cyan` |
| `project` | laranja | `--neon-orange` |
| `person` | magenta | `--neon-magenta` |
| outro/desconhecido | cinza | `--text-secondary` |

Como `vis-network` desenha em `<canvas>`, não lê CSS var em runtime sozinho —
resolver com `getComputedStyle(document.documentElement).getPropertyValue(...)`
uma vez, no load, e passar o hex resultante pro `options.groups`.

**Integração em `loadGraph()`** (não substitui a função, estende):

```js
async function loadGraph() {
  // ...corpo atual inalterado até a linha que monta as 3 listas...
  const { nodes, edges } = buildGraphDatasets(g);
  renderKnowledgeGraphNetwork(nodes, edges); // nova função
}

let kgNetwork; // singleton, reaproveita entre chamadas de loadGraph()
function renderKnowledgeGraphNetwork(nodes, edges) {
  const container = document.getElementById("graph-network");
  if (!container) return;
  const cs = getComputedStyle(document.documentElement);
  const options = {
    groups: {
      organization: { color: { background: cs.getPropertyValue("--neon-cyan").trim() } },
      project:      { color: { background: cs.getPropertyValue("--neon-orange").trim() } },
      person:       { color: { background: cs.getPropertyValue("--neon-magenta").trim() } },
    },
    nodes: { shape: "dot", size: 16, font: { color: "#0a0a0e", face: "monospace", size: 12 } },
    edges: { color: { color: cs.getPropertyValue("--text-secondary").trim(), opacity: 0.5 },
             font: { size: 10, color: cs.getPropertyValue("--text-secondary").trim(), strokeWidth: 0 },
             smooth: { type: "dynamic" } },
    physics: { barnesHut: { gravitationalConstant: -4000, springLength: 110 } },
    interaction: { hover: true, dragNodes: true, zoomView: true },
  };
  if (kgNetwork) { kgNetwork.setData({ nodes, edges }); return; }
  kgNetwork = new vis.Network(container, { nodes, edges }, options);
  kgNetwork.on("click", (params) => {
    if (!params.nodes.length) return;
    // Reaproveita o filtro que já existe, não duplica busca
    $("#graph-entities-q").value = params.nodes[0];
    loadGraph();
  });
}
```

O clique num nó preenche `#graph-entities-q` (o input de filtro que já existe)
e chama `loadGraph()` de novo — a lista de baixo passa a mostrar só o que foi
clicado. Zero filtro novo pra manter, reaproveita o que já existia.

**HTML** (`packages/daemon/web/index.html`) — container novo acima das 3
colunas de lista, dentro de `tab-hud`:

```html
<script src="https://unpkg.com/vis-network@9.1.9/standalone/umd/vis-network.min.js" defer></script>
...
<div id="graph-network" style="height:320px;border:1px solid var(--border);border-radius:var(--r-md);margin-bottom:12px;"></div>
```

**CSS** — nenhuma classe nova obrigatória; o `style` inline acima já basta pro
v1. Se quiser legenda (recomendado), adicionar 3 `<span>` com bolinha colorida
acima do container, mesmo padrão dos `.chip` existentes em `app.css:444`.

## Cuidado: não confundir com `startNetworkGraph`

`app.js` já tem uma função `startNetworkGraph()` (linha ~296) que desenha um
canvas de partículas animado — é fundo decorativo de outra tela
(`network-canvas`), não relacionado a este grafo. Nomes escolhidos acima
(`buildGraphDatasets`, `renderKnowledgeGraphNetwork`, `graph-network`)
evitam colisão de propósito.

## Fora de escopo (fase 2, não incluído aqui)

- **Aba LANGGRAPH com vis-network**: trocar `renderLangGraphSvg` (SVG
  desenhado à mão) pelo mesmo `vis-network` em modo `physics: false`
  (layout hierárquico fixo), mantendo `lgActiveNode` como está — essa lógica
  já funciona e não deve ser tocada, só a camada de desenho. Vale menos a pena
  que o GRAFO porque ali já existe highlight de execução real; é polish
  visual, não gap funcional.
- Legenda clicável (toggle de grupo).
- Persistir posição de nó arrastado entre reloads (`vis-network` tem API pra
  isso — `network.getPositions()` — mas exigiria armazenar em algum lugar,
  provavelmente `localStorage` por soul; decisão adiada).

## Testes

Sem teste automatizado de canvas/WebGL nesta stack (`node --test`, sem jsdom
para canvas). Cobertura fica em:
- `packages/daemon/src/test/*graph*.test.ts` (se existir) continua validando
  o endpoint `/souls/:id/graph` — inalterado por este trabalho.
- Verificação manual: soul com 0 entidades (grafo vazio não deve quebrar),
  soul com relação citando entidade fora do filtro atual (não deve lançar erro
  do vis-network), soul grande (KinetisWan/SLCA no screenshot original tinham
  ~10 entidades — checar performance de layout de força nessa escala antes de
  soul maior).

## Rollback

Reverter o commit. Sem migração, sem coluna nova, sem rota nova — o único
estado é o `<script src>` do CDN e as duas funções novas em `app.js`. Remover
o `<div id="graph-network">` também é suficiente pra voltar ao comportamento
atual (só listas), mesmo sem reverter o JS.
