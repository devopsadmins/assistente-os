#!/usr/bin/env bash
# =============================================================================
#  Assistente OS — instalador guiado
#
#  Sobe o sistema numa máquina limpa: checa pré-requisitos, instala e compila,
#  bootstrapa ~/.assistant-os/.env (interativo), sobe o Postgres, aplica as
#  migrações e deixa pronto pra `pm2 start` ou `npm run os daemon`.
#
#  Idempotente: pode rodar de novo com segurança. Nunca apaga dados nem
#  sobrescreve o .env sem backup.
#
#  Uso:
#    ./scripts/setup.sh            # interativo (recomendado na 1ª vez)
#    ./scripts/setup.sh --yes      # não-interativo (usa defaults / .env atual)
#    ./scripts/setup.sh --pm2      # ao final, sobe via PM2
#    ./scripts/setup.sh --skip-build   # pula npm ci / build (re-run rápido)
#    ./scripts/setup.sh --help
# =============================================================================
set -euo pipefail

# ── cores (com fallback pra terminal sem tput) ───────────────────────────────
if [ -t 1 ] && command -v tput >/dev/null 2>&1 && [ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]; then
  BOLD=$(tput bold); DIM=$(tput dim); RED=$(tput setaf 1); GRN=$(tput setaf 2)
  YLW=$(tput setaf 3); BLU=$(tput setaf 4); CYN=$(tput setaf 6); RST=$(tput sgr0)
else
  BOLD=""; DIM=""; RED=""; GRN=""; YLW=""; BLU=""; CYN=""; RST=""
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

ASSUME_YES=0; DO_PM2=0; SKIP_BUILD=0
for arg in "$@"; do
  case "$arg" in
    -y|--yes) ASSUME_YES=1 ;;
    --pm2)    DO_PM2=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    -h|--help) sed -n '/^#  Assistente OS/,/^# ===\+ *$/{/^# ===/d;s/^#\( \|$\)//;p}' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "${RED}argumento desconhecido: $arg${RST}"; exit 2 ;;
  esac
done

STEP=0
say()   { printf '%s\n' "$*"; }
info()  { printf '  %s%s%s\n' "$DIM" "$*" "$RST"; }
ok()    { printf '  %s✓%s %s\n' "$GRN" "$RST" "$*"; }
warn()  { printf '  %s!%s %s\n' "$YLW" "$RST" "$*"; }
err()   { printf '  %s✗%s %s\n' "$RED" "$RST" "$*"; }
step()  { STEP=$((STEP+1)); printf '\n%s%s══ Passo %d — %s%s\n' "$BOLD" "$BLU" "$STEP" "$*" "$RST"; }
die()   { err "$*"; printf '\n%sInstalação interrompida.%s Corrija o item acima e rode de novo.\n' "$RED" "$RST"; exit 1; }

# ask "pergunta" "default"  → ecoa a resposta (default se --yes ou ENTER)
ask() {
  local q="$1" def="${2:-}" ans
  if [ "$ASSUME_YES" = 1 ]; then printf '%s' "$def"; return; fi
  if [ -n "$def" ]; then printf '  %s%s%s [%s]: ' "$CYN" "$q" "$RST" "$def" >&2
  else printf '  %s%s%s: ' "$CYN" "$q" "$RST" >&2; fi
  read -r ans || true
  printf '%s' "${ans:-$def}"
}
# confirm "pergunta" "S"|"N"  → retorna 0 (sim) / 1 (não)
confirm() {
  local q="$1" def="${2:-S}" ans
  if [ "$ASSUME_YES" = 1 ]; then [ "$def" = "S" ]; return; fi
  local hint="[S/n]"; [ "$def" = "N" ] && hint="[s/N]"
  printf '  %s%s%s %s ' "$CYN" "$q" "$RST" "$hint" >&2
  read -r ans || true
  ans="${ans:-$def}"
  case "$ans" in [SsYy]*) return 0 ;; *) return 1 ;; esac
}

trap 'err "falhou na linha $LINENO"; printf "\n%sVeja a mensagem acima. É seguro rodar o setup de novo.%s\n" "$YLW" "$RST"' ERR

# =============================================================================
printf '%s%s\n' "$BOLD" "$CYN"
cat <<'BANNER'
   ___                _      __             __  ___  ____
  / _ | ___ ___ (_)__ / /____ ___  / /_ ___    / _ \/ __/
 / __ |(_-<(_-</ (_-</ __/ -_) _ \/ __// -_)  / // /\ \
/_/ |_/___/___/_/___/\__/\__/_//_/\__/ \__/  /____/___/    setup guiado
BANNER
printf '%s' "$RST"
say "${DIM}repo: $REPO_ROOT${RST}"
[ "$ASSUME_YES" = 1 ] && warn "modo --yes: sem perguntas, usa defaults e o .env atual."

# =============================================================================
step "Pré-requisitos"
HARD_FAIL=0

need_node="22.16.0"
if command -v node >/dev/null 2>&1; then
  have_node="$(node -p 'process.versions.node')"
  # compara major.minor.patch numericamente
  if [ "$(printf '%s\n%s\n' "$need_node" "$have_node" | sort -V | head -1)" = "$need_node" ]; then
    ok "Node $have_node  (mínimo $need_node)"
  else
    err "Node $have_node é antigo — precisa >= $need_node."
    info "instale via nvm:  nvm install 22 && nvm use 22"
    HARD_FAIL=1
  fi
else
  err "Node não encontrado."
  info "https://nodejs.org  ou  nvm install 22"
  HARD_FAIL=1
fi

command -v npm >/dev/null 2>&1 && ok "npm $(npm -v)" || { err "npm não encontrado (vem com o Node)."; HARD_FAIL=1; }
command -v git >/dev/null 2>&1 && ok "git $(git --version | awk '{print $3}')" || warn "git não encontrado — ok pra rodar, não pra atualizar."

DOCKER_OK=0
if command -v docker >/dev/null 2>&1; then
  if docker info >/dev/null 2>&1; then
    if docker compose version >/dev/null 2>&1; then
      ok "docker + compose  ($(docker --version | awk '{print $3}' | tr -d ,))"
      DOCKER_OK=1
    else
      warn "docker existe mas 'docker compose' (v2) não — Postgres via compose indisponível."
    fi
  else
    warn "docker instalado mas o daemon não responde (permissão? serviço parado?)."
    info "linux:  sudo systemctl start docker  ·  sudo usermod -aG docker \$USER  (e re-login)"
  fi
else
  warn "docker não encontrado — você precisará de um Postgres externo (com pgvector)."
fi

OLLAMA_URL_DEFAULT="${OLLAMA_URL:-http://localhost:11434}"
if curl -fsS --max-time 3 "$OLLAMA_URL_DEFAULT/api/tags" >/dev/null 2>&1; then
  models="$(curl -fsS --max-time 3 "$OLLAMA_URL_DEFAULT/api/tags" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log((JSON.parse(d).models||[]).map(m=>m.name).join(", ")||"(nenhum modelo baixado)")}catch{console.log("?")}})' 2>/dev/null || echo "?")"
  ok "Ollama vivo em $OLLAMA_URL_DEFAULT  — modelos: $models"
else
  warn "Ollama não respondeu em $OLLAMA_URL_DEFAULT — o tier 'local' e o --faithfulness ficam indisponíveis (o sistema degrada pra 'zen'/literal)."
  info "https://ollama.com  ·  depois:  ollama pull qwen2.5-coder:3b && ollama pull nomic-embed-text"
fi

command -v pg_dump >/dev/null 2>&1 && ok "pg_dump/pg_restore presentes (backup completo + restore e2e)" \
  || warn "pg_dump não encontrado — backup degrada pra só-arquivos; o teste de restore e2e exige."

[ "$HARD_FAIL" = 1 ] && die "pré-requisito obrigatório faltando (Node/npm)."
[ "$ASSUME_YES" = 1 ] || { confirm "Seguir com a instalação?" "S" || { say "abortado."; exit 0; }; }

# =============================================================================
step "Dependências e build"
if [ "$SKIP_BUILD" = 1 ]; then
  warn "--skip-build: pulando npm ci / build / typecheck."
else
  if [ -f package-lock.json ]; then
    info "npm ci  (instala exatamente o package-lock — pode demor, baixa ~centenas de MB, inclui @xenova/transformers)"
    npm ci
  else
    info "npm install  (sem package-lock)"
    npm install
  fi
  ok "dependências instaladas"

  info "npm run build  (tsc -b em core → memory → voice → daemon → tools → cli)"
  npm run build
  ok "build ok"

  info "npm run typecheck"
  if npm run typecheck; then ok "typecheck limpo"; else die "typecheck falhou — o código no disco não compila."; fi
fi

# =============================================================================
step "Diretório de dados (ASSISTENTE_OS_HOME)"
HOME_DEFAULT="${ASSISTENTE_OS_HOME:-$HOME/.assistant-os}"
AOS_HOME="$(ask 'Onde ficam souls/, .env, backups?' "$HOME_DEFAULT")"
AOS_HOME="${AOS_HOME/#\~/$HOME}"
mkdir -p "$AOS_HOME/souls"
ok "home: $AOS_HOME"
ENV_FILE="$AOS_HOME/.env"
if [ "$AOS_HOME" != "$HOME/.assistant-os" ]; then
  warn "home não-padrão: exporte ASSISTENTE_OS_HOME=$AOS_HOME no shell / no PM2 (o .env é lido de <home>/.env — não dá pra definir a própria home dentro dele)."
fi

# link .env do repo → home (loadDotEnv lê da home; alguns fluxos leem do repo)
if [ ! -e "$REPO_ROOT/.env" ]; then
  ln -s "$ENV_FILE" "$REPO_ROOT/.env" && info "criado symlink $REPO_ROOT/.env → $ENV_FILE"
fi

# =============================================================================
step "Configuração (.env)"
# helper: lê valor atual de uma chave no ENV_FILE (sem comentário inline / espaços)
envget() {
  [ -f "$ENV_FILE" ] || return 0
  sed -n "s/^${1}=//p" "$ENV_FILE" | head -1 | sed -E 's/[[:space:]]+#.*$//; s/^[[:space:]]+//; s/[[:space:]]+$//'
}

if [ -f "$ENV_FILE" ]; then
  BK="$ENV_FILE.bak.$(date +%Y%m%d-%H%M%S)"
  cp "$ENV_FILE" "$BK"
  ok ".env já existe — backup em $BK; vou só completar o que faltar"
else
  if [ -f "$REPO_ROOT/.env.example" ]; then
    cp "$REPO_ROOT/.env.example" "$ENV_FILE"
    ok "criado $ENV_FILE a partir de .env.example"
  else
    : > "$ENV_FILE"
    warn "sem .env.example — criando .env vazio"
  fi
fi

# upsert KEY=VALUE — substitui a linha existente (com ou sem #), senão anexa.
setenv() {
  local key="$1" val="$2" esc
  [ -z "$val" ] && return 0
  # escapa para o lado direito do s|...|...| do sed: barra, & e o delimitador |
  esc=$(printf '%s' "$val" | sed -e 's/[\\&|]/\\&/g')
  if grep -qE "^#?[[:space:]]*${key}=" "$ENV_FILE"; then
    sed -i -E "s|^#?[[:space:]]*${key}=.*|${key}=${esc}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$val" >> "$ENV_FILE"
  fi
}

# --- Postgres ---
say ""
info "Postgres (com pgvector) é obrigatório — guarda RAG, grafo, sessões, custos, agenda."
PG_CHOICE="externo"
if [ "$DOCKER_OK" = 1 ]; then
  if confirm "Subir o Postgres empacotado via 'docker compose' (pgvector/pgvector:pg17, porta 5432)?" "S"; then
    PG_CHOICE="compose"
    setenv DATABASE_URL "postgres://assistente_os:assistente_os@localhost:5432/assistente_os"
    ok "DATABASE_URL → localhost:5432 (compose)"
  fi
fi
if [ "$PG_CHOICE" = "externo" ]; then
  cur="$(envget DATABASE_URL)"
  DB="$(ask 'DATABASE_URL do seu Postgres (com extensão vector)' "${cur:-postgres://user:pass@host:5432/db}")"
  setenv DATABASE_URL "$DB"
  warn "garanta:  CREATE EXTENSION IF NOT EXISTS vector;  no banco de destino."
fi

# --- Ollama ---
say ""
cur="$(envget OLLAMA_URL)"; OU="$(ask 'OLLAMA_URL' "${cur:-$OLLAMA_URL_DEFAULT}")"; setenv OLLAMA_URL "$OU"
cur="$(envget OLLAMA_CHAT_MODEL)";  setenv OLLAMA_CHAT_MODEL  "$(ask 'modelo de chat' "${cur:-qwen2.5-coder:3b}")"
cur="$(envget OLLAMA_EMBED_MODEL)"; setenv OLLAMA_EMBED_MODEL "$(ask 'modelo de embeddings' "${cur:-nomic-embed-text}")"

# --- Daemon: host / porta / token ---
say ""
cur="$(envget AOS_HOST)"; HOST="$(ask 'AOS_HOST (bind do daemon)' "${cur:-127.0.0.1}")"; setenv AOS_HOST "$HOST"
cur="$(envget AOS_PORT)"; setenv AOS_PORT "$(ask 'AOS_PORT' "${cur:-4310}")"
TOK="$(envget ASSISTENTE_OS_DAEMON_TOKEN)"
if [ "$HOST" != "127.0.0.1" ] && [ "$HOST" != "localhost" ] && [ "$HOST" != "::1" ]; then
  warn "host não-loopback: o daemon RECUSA o boot sem ASSISTENTE_OS_DAEMON_TOKEN."
fi
if [ -z "$TOK" ] && confirm "Gerar um ASSISTENTE_OS_DAEMON_TOKEN forte agora?" "S"; then
  TOK="$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
  setenv ASSISTENTE_OS_DAEMON_TOKEN "$TOK"
  ok "token gerado (guarde — os clientes precisam dele no header Authorization: Bearer)"
  printf '     %s%s%s\n' "$BOLD" "$TOK" "$RST"
elif [ -n "$TOK" ]; then
  ok "ASSISTENTE_OS_DAEMON_TOKEN já configurado"
fi

# --- Zen (opcional) ---
say ""
if confirm "Configurar chave(s) OpenCode Zen (tier 'zen', fallback quando o Ollama não dá conta)?" "N"; then
  ZK="$(ask 'ZEN_API_KEYS (vírgula-separadas; ou deixe vazio p/ pular)' "$(envget ZEN_API_KEYS)")"
  setenv ZEN_API_KEYS "$ZK"
fi

# --- flags de teste (runbook docs/TESTES-DEPLOY-COMPLETO.md) ---
say ""
info "Flags novas (default OFF/conservador). Ligar as de teste NÃO muda o default de produção."
if confirm "Ligar o pacote de flags de TESTE agora (confidence, amostragem, rerank multilíngue, cache semântico, escalonamento)?" "N"; then
  setenv AOS_RAG_MIN_CONFIDENCE "0.4"
  setenv AOS_RAG_FAITHFULNESS_SAMPLE "0.3"
  setenv RAG_RERANK "cross-encoder"
  setenv RAG_RERANK_CE_MODEL "Xenova/bge-reranker-base"
  setenv RAG_SEMANTIC_CACHE "on"
  setenv ROUTER_ESCALATION "on"
  ok "flags de teste ligadas — ver docs/TESTES-DEPLOY-COMPLETO.md §4 para o protocolo"
  warn "MCP_ZERO_TRUST NÃO foi ligado: exige 'agent.autonomy' nos config.json das souls, senão nega toda tool L3."
fi
chmod 600 "$ENV_FILE" 2>/dev/null || true
ok "$ENV_FILE gravado (modo 600)"

# =============================================================================
step "Postgres"
export DATABASE_URL="$(envget DATABASE_URL)"
if [ "$PG_CHOICE" = "compose" ]; then
  info "docker compose up -d postgres"
  docker compose up -d postgres
  printf '  aguardando o healthcheck do Postgres'
  for i in $(seq 1 40); do
    if [ "$(docker compose ps -q postgres 2>/dev/null | xargs -r docker inspect -f '{{.State.Health.Status}}' 2>/dev/null)" = "healthy" ]; then
      printf '\n'; ok "Postgres healthy"; break
    fi
    printf '.'; sleep 2
    [ "$i" = 40 ] && { printf '\n'; die "Postgres não ficou healthy em 80s — veja 'docker compose logs postgres'."; }
  done
else
  info "testando conexão em $DATABASE_URL"
  if node -e 'const{Client}=require("pg");const c=new Client({connectionString:process.env.DATABASE_URL});c.connect().then(()=>c.query("select 1")).then(()=>{console.log("ok");return c.end()}).catch(e=>{console.error(e.message);process.exit(1)})'; then
    ok "conexão ao Postgres externa OK"
  else
    die "não conectei em DATABASE_URL — confira host/porta/credenciais e a extensão 'vector'."
  fi
fi

# =============================================================================
step "Migrações + smoke"
info "npm run os status  (aplica as migrações 0001..00NN e imprime souls/ollama/degraus)"
set +e
STATUS_OUT="$(npm run --silent os status 2>&1)"; RC=$?
set -e
printf '%s\n' "$STATUS_OUT" | sed 's/^/    /'
[ $RC -ne 0 ] && die "'os status' falhou (rc=$RC) — normalmente é DATABASE_URL ou migração."
if printf '%s' "$STATUS_OUT" | grep -q "DRIFT"; then
  warn "apareceu [migrations] DRIFT numa instalação — se este repo é limpo (sem edições locais em migrations.ts), reporte."
fi
ok "migrações aplicadas"

# =============================================================================
step "Soul inicial + índice (opcional)"
FIRST_SOUL="$(ls "$AOS_HOME/souls" 2>/dev/null | head -1 || true)"
if [ -n "$FIRST_SOUL" ]; then
  info "soul encontrada: $FIRST_SOUL"
  if confirm "Indexar a memória da soul '$FIRST_SOUL' agora (RAG)?" "S"; then
    npm run --silent os memory "$FIRST_SOUL" index && npm run --silent os memory "$FIRST_SOUL" status
    ok "índice pronto"
  fi
else
  warn "nenhuma soul em $AOS_HOME/souls — crie via MCP soul_create ou montando a pasta manualmente"
  info "mínimo:  mkdir -p $AOS_HOME/souls/teste/sources && echo '# teste' > $AOS_HOME/souls/teste/perfil.md"
fi

# =============================================================================
step "Subir o daemon"
PORT="$(envget AOS_PORT)"; PORT="${PORT:-4310}"
if [ "$DO_PM2" = 1 ] || { [ "$ASSUME_YES" != 1 ] && confirm "Subir agora via PM2 (recomendado p/ deixar rodando)?" "N"; }; then
  if ! command -v pm2 >/dev/null 2>&1; then
    if confirm "PM2 não está instalado. 'npm i -g pm2' agora?" "S"; then npm i -g pm2; else warn "pulei o PM2."; fi
  fi
  if command -v pm2 >/dev/null 2>&1; then
    pm2 start ecosystem.config.cjs && pm2 save
    ok "PM2: apps 'assistente-os', 'assistente-os-backup', 'soul-rag-watcher' subindo"
    info "logs:  pm2 logs assistente-os    ·    parar:  pm2 stop assistente-os"
    info "boot automático:  pm2 startup   (siga a linha que ele imprimir)"
  fi
else
  info "para subir manualmente:"
  printf '     %snpm run os daemon%s        # foreground, porta %s\n' "$BOLD" "$RST" "$PORT"
  printf '     %spm2 start ecosystem.config.cjs%s   # em background\n' "$BOLD" "$RST"
fi

# =============================================================================
printf '\n%s%s══ Pronto%s\n' "$BOLD" "$GRN" "$RST"
say ""
say "  ${BOLD}Verificação rápida${RST} (com o daemon no ar):"
TOKH=""; [ -n "$(envget ASSISTENTE_OS_DAEMON_TOKEN)" ] && TOKH="-H \"Authorization: Bearer \$ASSISTENTE_OS_DAEMON_TOKEN\""
printf '    curl -s localhost:%s/health\n' "$PORT"
printf '      %s→ {"ok":true,"service":"assistente-os"}  (sem lista de souls — de propósito)%s\n' "$DIM" "$RST"
printf '    curl -s %s localhost:%s/infra/status | head\n' "$TOKH" "$PORT"
say ""
say "  ${BOLD}Próximos passos${RST}:"
say "    • Protocolo de teste de comportamento (12 checks):  ${CYN}docs/TESTES-DEPLOY-COMPLETO.md${RST}"
say "    • Avaliação de RAG:  ${BOLD}npm run os rag eval <soul> --faithfulness --record${RST}  →  ${BOLD}npm run os rag eval <soul> --history${RST}"
say "    • Trace de um turno:  pegue o header ${BOLD}x-trace-id${RST} de POST /souls/<id>/chat  →  ${BOLD}npm run os trace <id>${RST}"
say "    • Todas as variáveis:  ${CYN}.env.example${RST}  ·  editar:  ${BOLD}\$EDITOR $ENV_FILE${RST}"
say ""
[ "$ASSUME_YES" = 1 ] || info "rode ./scripts/setup.sh de novo a qualquer momento — é idempotente."
