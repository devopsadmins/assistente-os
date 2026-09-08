## Descrição

Substitui as três listas de texto da aba GRAFO (entidades/relações/observações,
`packages/daemon/web/assets/app.js::loadGraph`) por um grafo de nós/arestas
navegável via `vis-network` (CDN, sem entrar no `package.json`). Reaproveita o
payload já retornado por `GET /souls/:id/graph` — sem migração, sem rota nova.
Ver `docs/GRAPH-VISUALIZATION.md` pro design completo.

## Plano (arquivos + ordem)

1. `packages/daemon/web/index.html` — adiciona `<script src="unpkg.com/vis-network...">`
   (mesmo padrão do `qrcodejs` já carregado nesta página) e o container
   `<div id="graph-network">` dentro de `tab-hud`, antes das 3 colunas de lista.
   Vem primeiro porque `app.js` depende do elemento existir no DOM.
2. `packages/daemon/web/assets/app.js` — adiciona `buildGraphDatasets(g)` e
   `renderKnowledgeGraphNetwork(nodes, edges)`; estende `loadGraph()` (linha
   ~601) pra chamar as duas no fim, sem alterar o comportamento das 3 listas
   existentes. Vem depois do HTML porque referencia `#graph-network`.
3. Verificação manual (ver seção Testes de `docs/GRAPH-VISUALIZATION.md`) —
   soul vazia, soul com relação órfã, soul grande — antes de abrir o PR pra
   review.

## Rastreabilidade

Ref: docs/GRAPH-VISUALIZATION.md (não há item de roadmap prévio pra isso —
sugerir adicionar como novo item em `docs/ROADMAP.md` na próxima atualização
do documento, já que ele é o backlog vivo único desde o arquivamento de 2026-09-06).

## Rollback

Revert do commit. Sem migração, sem coluna nova, sem rota nova — único estado
novo é o `<script src>` do CDN e duas funções em `app.js`. Remover só o
`<div id="graph-network">` já é suficiente pra voltar ao comportamento atual
(3 listas, sem grafo), mesmo sem reverter o JS.
