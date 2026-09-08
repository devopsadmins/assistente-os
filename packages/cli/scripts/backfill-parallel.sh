#!/usr/bin/env bash
# Backfill paralelo de entidades para todas as souls (exceto consultoria_ia).
# Pool de concorrência fixo via wait -n. Cada soul roda um processo próprio,
# logs isolados em /tmp/backfill-<soul>.log.
#
# ATENÇÃO: o próprio CLI (packages/cli/dist) avisa que paralelismo entre
# souls mostrou taxa de falha maior em dados reais — este script é uma
# tentativa deliberada de acelerar; monitore os logs e, se a taxa de falha
# subir, reduza MAX_CONCURRENT ou rode serial.
set -euo pipefail

# Config
MAX_CONCURRENT="${MAX_CONCURRENT:-2}"
CLI="node packages/cli/dist/index.js"
LOG_DIR="${LOG_DIR:-/tmp}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

# Somente souls com pasta em ~/.assistant-os/souls (o CLI exige a pasta existir;
# souls como slcia/desenvolvimento têm chunks no DB mas não são materializadas
# como soul — getSoul falharia com "soul não encontrada"). consultoria_ia
# excluída conforme pedido.
SOULS=(
  aprendizado escrita financeiro-casa investimentos
  ministro_louvor default
)

# Timeout menor por chamada de extração (evita travar 3min em falha)
export ENTITY_EXTRACTION_TIMEOUT_MS="${ENTITY_EXTRACTION_TIMEOUT_MS:-90000}"
export GRAPH_ENTITY_DEDUP="${GRAPH_ENTITY_DEDUP:-false}"

cd "$REPO_DIR"

declare -A pids_pool=()

echo "[$(date -Iseconds)] Backfill paralelo: ${#SOULS[@]} souls, MAX_CONCURRENT=$MAX_CONCURRENT"
echo "[$(date -Iseconds)] Repo: $REPO_DIR | timeout_extração=$ENTITY_EXTRACTION_TIMEOUT_MS | dedup=$GRAPH_ENTITY_DEDUP"

for soul in "${SOULS[@]}"; do
  # Mantém pool de concorrência: espera o primeiro terminar se estiver cheio
  while (( ${#pids_pool[@]} >= MAX_CONCURRENT )); do
    wait -n
    for pid in "${!pids_pool[@]}"; do
      kill -0 "$pid" 2>/dev/null || { unset "pids_pool[$pid]"; }
    done
  done

  echo "[$(date -Iseconds)] Iniciando $soul..."
  ( cd "$REPO_DIR" && $CLI memory backfill-entities --soul "$soul" ) >> "$LOG_DIR/backfill-$soul.log" 2>&1 &
  pids_pool[$!]="$soul"
done

echo "[$(date -Iseconds)] Todos os souls lançados. Aguardando conclusão..."

for pid in "${!pids_pool[@]}"; do
  wait "$pid"
  st=$?
  echo "[$(date -Iseconds)] Finalizado ${pids_pool[$pid]} (exit $st)"
done

echo "[$(date -Iseconds)] Todos concluídos."

# Resumo final
echo ""
echo "=== RESUMO ==="
for soul in "${SOULS[@]}"; do
  log="$LOG_DIR/backfill-$soul.log"
  if [[ -f "$log" ]]; then
    echo "--- $soul: $(tail -1 "$log")"
  fi
done
