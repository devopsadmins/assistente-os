#!/usr/bin/env bash
# Backfill serial das souls pendentes (exceto consultoria_ia), gerenciado via PM2.
# Roda uma soul de cada vez — respeita a recomendação do CLI de que paralelismo
# entre souls aumenta a taxa de falha e evita contenção do Ollama.
set -euo pipefail

CLI="node packages/cli/dist/index.js"
LOG_DIR="${LOG_DIR:-/tmp}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

# Souls com pasta existente e docs pendentes. main incluída para reprocessar as 9 falhas.
SOULS=(
  aprendizado escrita financeiro-casa investimentos
  ministro_louvor default main
)

# Timeout menor por chamada de extração (evita travar 3min em falha).
export ENTITY_EXTRACTION_TIMEOUT_MS="${ENTITY_EXTRACTION_TIMEOUT_MS:-90000}"
export GRAPH_ENTITY_DEDUP="${GRAPH_ENTITY_DEDUP:-false}"

cd "$REPO_DIR"

echo "[$(date -Iseconds)] Backfill serial: ${#SOULS[@]} souls | timeout=$ENTITY_EXTRACTION_TIMEOUT_MS | dedup=$GRAPH_ENTITY_DEDUP"

for soul in "${SOULS[@]}"; do
  echo "[$(date -Iseconds)] === Iniciando $soul ==="
  start=$(date +%s)
  if $CLI memory backfill-entities --soul "$soul" >> "$LOG_DIR/backfill-$soul.log" 2>&1; then
    st=0
  else
    st=$?
  fi
  dur=$(( $(date +%s) - start ))
  echo "[$(date -Iseconds)] === Finalizado $soul (exit $st, ${dur}s) ==="
done

echo "[$(date -Iseconds)] Todos os souls concluídos."
