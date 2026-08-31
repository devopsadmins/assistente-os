#!/usr/bin/env bash
# =============================================================================
#  Assistente OS — instalador guiado
#
#  Sobe o sistema numa máquina limpa: checa pré-requisitos, instala e compila,
#  bootstrapa ~/.assistant-os/.env (interativo), sobe Postgres+pgvector e
#  Ollama (com os modelos configurados) — ou usa os que você já tem — aplica
#  as migrações e deixa pronto pra `pm2 start` ou `npm run os daemon`. Cada
#  etapa pergunta antes de instalar algo novo e termina num resumo do que
#  ficou pronto e do que ficou pendente.
#
#  Idempotente: pode rodar de novo com segurança. Nunca apaga dados nem
#  sobrescreve o .env sem backup. Sob --yes, instalação de sistema (Ollama,
#  'docker start') é pulada por segurança — vira item pendente no resumo.
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

# relatório final — acumulado a cada etapa, impresso no passo "Resumo"
REPORT_DONE=()
REPORT_PENDING=()
mark_done()    { REPORT_DONE+=("$*"); }
mark_pending() { REPORT_PENDING+=("$*"); }

# lista (uma por linha) os modelos já baixados num Ollama em $1 (URL); vazio se
# não respondeu ou não tem nenhum.
ollama_models() {
  # "|| true": sob 'pipefail', um curl que falha (Ollama fora do ar) derrubaria
  # o script inteiro por 'set -e' mesmo o node (último elo) saindo 0 — aqui é
  # esperado que o Ollama não esteja no ar ainda, então isso é silencioso.
  curl -fsS --max-time 3 "$1/api/tags" 2>/dev/null | node -e '
let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
  try { (JSON.parse(d).models||[]).forEach(m=>console.log(m.name)); } catch {}
});' 2>/dev/null || true
}
# ollama_model_present <url> <nome>  — o Ollama sempre lista com tag (":latest"
# implícito quando não pedido); sem isso "nomic-embed-text" nunca bateria com
# "nomic-embed-text:latest" e o setup ofereceria baixar de novo à toa.
ollama_model_present() {
  local want="$2"
  case "$want" in *:*) : ;; *) want="${want}:latest" ;; esac
  ollama_models "$1" | grep -qxF "$want"
}

# is_wsl — true se rodando dentro do WSL (WSL1 ou WSL2)
is_wsl() {
  [ -n "${WSL_DISTRO_NAME:-}" ] && return 0
  grep -qi microsoft /proc/version 2>/dev/null
}
# wsl_host_ip — IP do host Windows visto de dentro do WSL2 (gateway da rede NAT).
# Vazio se não for WSL ou não conseguir descobrir. Esse IP pode mudar a cada
# reboot do Windows/WSL (a menos que networkingMode=mirrored esteja ligado no
# .wslconfig, aí 'localhost' já basta e este helper nem é chamado).
wsl_host_ip() {
  ip route show default 2>/dev/null | awk '{print $3; exit}'
}

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
      mark_pending "docker sem 'compose' v2 — Postgres precisará ser externo"
    fi
  else
    warn "docker instalado mas o daemon não responde (permissão? serviço parado?)."
    if [ "$(uname -s 2>/dev/null)" = "Linux" ] && command -v systemctl >/dev/null 2>&1 \
       && [ "$ASSUME_YES" != 1 ] && confirm "Tentar iniciar o serviço agora ('sudo systemctl start docker')?" "S"; then
      sudo systemctl start docker || true
      sleep 2
      if docker info >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
        ok "docker + compose  (serviço iniciado agora)"
        DOCKER_OK=1
        mark_done "docker: serviço iniciado por este setup"
      else
        warn "ainda não respondeu — pode precisar de 'sudo usermod -aG docker \$USER' + novo login."
        mark_pending "docker: daemon não respondeu após tentar iniciar — Postgres externo"
      fi
    else
      info "linux:  sudo systemctl start docker  ·  sudo usermod -aG docker \$USER  (e re-login)"
      mark_pending "docker: daemon parado — Postgres precisará ser externo"
    fi
  fi
else
  warn "docker não encontrado — você precisará de um Postgres externo (com pgvector)."
  mark_pending "docker ausente — Postgres precisará ser externo"
fi

OLLAMA_URL_DEFAULT="${OLLAMA_URL:-http://localhost:11434}"
if curl -fsS --max-time 3 "$OLLAMA_URL_DEFAULT/api/tags" >/dev/null 2>&1; then
  models="$(ollama_models "$OLLAMA_URL_DEFAULT" | tr '\n' ',' | sed 's/,$//')"
  ok "Ollama vivo em $OLLAMA_URL_DEFAULT  — modelos: ${models:-(nenhum modelo baixado)}"
elif is_wsl && [ -z "${OLLAMA_URL:-}" ] && host_ip="$(wsl_host_ip)" && [ -n "$host_ip" ] \
     && curl -fsS --max-time 3 "http://$host_ip:11434/api/tags" >/dev/null 2>&1; then
  # WSL: localhost não chega no Ollama do Windows, mas o gateway da rede NAT chega
  # — e ele respondeu. Usa como default em vez do localhost pro resto do setup.
  OLLAMA_URL_DEFAULT="http://$host_ip:11434"
  models="$(ollama_models "$OLLAMA_URL_DEFAULT" | tr '\n' ',' | sed 's/,$//')"
  ok "Ollama do Windows encontrado via WSL em $OLLAMA_URL_DEFAULT  — modelos: ${models:-(nenhum modelo baixado)}"
  info "isso é o IP do host Windows visto do WSL (\`ip route show default\`) — pode mudar após reboot;"
  info "se o Ollama parar de responder depois de reiniciar, rode esse comando de novo e atualize OLLAMA_URL no .env."
  mark_done "Ollama: detectado no host Windows via WSL ($OLLAMA_URL_DEFAULT)"
else
  warn "Ollama não respondeu em $OLLAMA_URL_DEFAULT — o tier 'local' e o --faithfulness ficam indisponíveis (o sistema degrada pra 'zen'/literal)."
  if is_wsl; then
    info "você está no WSL: se o Ollama roda no Windows, confira se 'Expose Ollama to the network' está ligado"
    info "(app do Ollama → Settings) e tente de novo — este setup detecta o IP do host automaticamente."
  fi
  info "este setup pode instalar e subir o Ollama pra você mais adiante (passo 'Ollama')."
  mark_pending "Ollama não respondia em $OLLAMA_URL_DEFAULT no início do setup"
fi

command -v pg_dump >/dev/null 2>&1 && { ok "pg_dump/pg_restore presentes (backup completo + restore e2e)"; mark_done "pg_dump/pg_restore presentes"; } \
  || { warn "pg_dump não encontrado — backup degrada pra só-arquivos; o teste de restore e2e exige."; mark_pending "pg_dump ausente — backup degrada pra só-arquivos, sem restore e2e"; }

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
  DB="$(ask 'já tem um Postgres (com extensão vector) pra usar? DATABASE_URL' "${cur:-postgres://user:pass@host:5432/db}")"
  setenv DATABASE_URL "$DB"
  info "vou testar a conexão e criar a extensão 'vector' se faltar, no passo 'Postgres' — nada é apagado."
fi

# --- Ollama ---
say ""
cur="$(envget OLLAMA_URL)"; OU="$(ask 'OLLAMA_URL (já tem um Ollama rodando? aponte pra ele)' "${cur:-$OLLAMA_URL_DEFAULT}")"; setenv OLLAMA_URL "$OU"
EXIST_MODELS="$(ollama_models "$OU")"
if [ -n "$EXIST_MODELS" ]; then
  info "modelos já baixados nesse Ollama: $(printf '%s' "$EXIST_MODELS" | tr '\n' ',' | sed 's/,$//')  — pode usar um destes abaixo."
fi
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
  [ -n "$ZK" ] && mark_done "Zen configurado (fallback do tier local)" || mark_pending "Zen não configurado — sem fallback além do Ollama local"
else
  mark_pending "Zen não configurado — sem fallback além do Ollama local"
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
      printf '\n'; ok "Postgres healthy"; mark_done "Postgres (compose, pgvector/pgvector:pg17) healthy"; break
    fi
    printf '.'; sleep 2
    [ "$i" = 40 ] && { printf '\n'; die "Postgres não ficou healthy em 80s — veja 'docker compose logs postgres'."; }
  done
else
  info "testando conexão em $DATABASE_URL (Postgres pré-existente)"
  if node -e 'const{Client}=require("pg");const c=new Client({connectionString:process.env.DATABASE_URL});c.connect().then(()=>c.query("select 1")).then(()=>c.query("CREATE EXTENSION IF NOT EXISTS vector")).then(()=>{console.log("ok");return c.end()}).catch(e=>{console.error(e.message);process.exit(1)})'; then
    ok "conexão OK e extensão 'vector' presente/criada"
    mark_done "Postgres pré-existente OK ($DATABASE_URL), pgvector confirmado"
  else
    mark_pending "Postgres externo: conexão ou 'CREATE EXTENSION vector' falhou"
    die "não conectei em DATABASE_URL, ou faltou permissão pra CREATE EXTENSION vector — confira host/porta/credenciais/privilégios."
  fi
fi

# =============================================================================
step "Ollama"
OU="$(envget OLLAMA_URL)"; OU="${OU:-$OLLAMA_URL_DEFAULT}"
ollama_alive() { curl -fsS --max-time 3 "$OU/api/tags" >/dev/null 2>&1; }
OLLAMA_BIN_OK=0; command -v ollama >/dev/null 2>&1 && OLLAMA_BIN_OK=1

ollama_wait_manual() {
  [ "$ASSUME_YES" = 1 ] && return 0
  confirm "Depois de instalar, aperte Enter aqui pra continuar" "S" || true
  command -v ollama >/dev/null 2>&1 && OLLAMA_BIN_OK=1
}

ollama_try_install() {
  local osname; osname="$(uname -s 2>/dev/null || echo unknown)"
  case "$osname" in
    Linux)
      if curl -fsSL https://ollama.com/install.sh | sh; then
        command -v ollama >/dev/null 2>&1 && OLLAMA_BIN_OK=1
      fi
      ;;
    Darwin)
      if command -v brew >/dev/null 2>&1; then
        if brew install ollama; then OLLAMA_BIN_OK=1; fi
      else
        warn "sem Homebrew — baixe manualmente: https://ollama.com/download/mac"
        ollama_wait_manual
      fi
      ;;
    MINGW*|MSYS*|CYGWIN*)
      if command -v winget >/dev/null 2>&1; then
        winget install --id Ollama.Ollama -e --silent --accept-package-agreements --accept-source-agreements || true
        command -v ollama >/dev/null 2>&1 && OLLAMA_BIN_OK=1
      else
        warn "sem winget — baixe manualmente: https://ollama.com/download/windows"
        ollama_wait_manual
      fi
      ;;
    *)
      warn "SO não reconhecido ($osname) — baixe manualmente: https://ollama.com"
      ollama_wait_manual
      ;;
  esac
}

if ollama_alive; then
  models="$(ollama_models "$OU" | tr '\n' ',' | sed 's/,$//')"
  ok "Ollama já rodando em $OU  — modelos: ${models:-(nenhum ainda)}"
  mark_done "Ollama rodando em $OU (pré-existente)"
else
  if [ "$OLLAMA_BIN_OK" != 1 ]; then
    if [ "$ASSUME_YES" = 1 ]; then
      warn "Ollama ausente — instalação automática pulada em modo --yes (evita rodar instalador de sistema sem confirmação)."
      mark_pending "Ollama ausente — rode ./scripts/setup.sh sem --yes pra instalar, ou instale manualmente"
    elif confirm "Ollama não encontrado em $OU. Instalar agora?" "S"; then
      ollama_try_install
      if [ "$OLLAMA_BIN_OK" = 1 ]; then ok "Ollama instalado"; else warn "instalação não confirmada — vou seguir sem ele."; fi
    else
      mark_pending "Ollama ausente — instalação recusada; tier 'local' e --faithfulness indisponíveis"
    fi
  fi

  if [ "$OLLAMA_BIN_OK" = 1 ] && ! ollama_alive; then
    info "subindo 'ollama serve' em background"
    nohup ollama serve >/tmp/ollama-setup.log 2>&1 &
    disown 2>/dev/null || true
    printf '  aguardando o Ollama subir'
    UP=0
    for i in $(seq 1 15); do
      if ollama_alive; then printf '\n'; UP=1; break; fi
      printf '.'; sleep 2
    done
    if [ "$UP" = 1 ]; then ok "Ollama no ar em $OU"; else printf '\n'; warn "Ollama instalado mas não respondeu em $OU — veja /tmp/ollama-setup.log"; fi
  fi

  if ollama_alive; then
    mark_done "Ollama instalado e rodando em $OU (feito por este setup)"
  elif [ "$OLLAMA_BIN_OK" = 1 ]; then
    mark_pending "Ollama instalado mas o servidor não respondeu em $OU"
  fi
fi

if ollama_alive; then
  for MVAR in OLLAMA_CHAT_MODEL OLLAMA_EMBED_MODEL; do
    MNAME="$(envget "$MVAR")"
    [ -z "$MNAME" ] && continue
    if ollama_model_present "$OU" "$MNAME"; then
      ok "modelo '$MNAME' já presente ($MVAR)"
      mark_done "Ollama: modelo $MNAME presente ($MVAR)"
    elif confirm "Baixar o modelo '$MNAME' agora ($MVAR — pode passar de 1GB)?" "S"; then
      if ollama pull "$MNAME"; then
        ok "modelo '$MNAME' baixado"
        mark_done "Ollama: modelo $MNAME baixado ($MVAR)"
      else
        warn "falha ao baixar '$MNAME' — confira o nome do modelo em https://ollama.com/library"
        mark_pending "Ollama: falha ao baixar $MNAME ($MVAR)"
      fi
    else
      mark_pending "Ollama: modelo $MNAME não baixado — $MVAR ficará indisponível até baixar"
    fi
  done
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
  mark_pending "[migrations] DRIFT detectado — ver 'os status' acima"
fi
ok "migrações aplicadas"
mark_done "migrações aplicadas (schema_migrations em dia)"

# =============================================================================
step "Soul inicial + índice (opcional)"
FIRST_SOUL="$(ls "$AOS_HOME/souls" 2>/dev/null | head -1 || true)"
if [ -n "$FIRST_SOUL" ]; then
  info "soul encontrada: $FIRST_SOUL"
  if confirm "Indexar a memória da soul '$FIRST_SOUL' agora (RAG)?" "S"; then
    npm run --silent os memory "$FIRST_SOUL" index && npm run --silent os memory "$FIRST_SOUL" status
    ok "índice pronto"
    mark_done "soul '$FIRST_SOUL' indexada (RAG)"
  else
    mark_pending "soul '$FIRST_SOUL' encontrada mas não indexada"
  fi
else
  warn "nenhuma soul em $AOS_HOME/souls — crie via MCP soul_create ou montando a pasta manualmente"
  info "mínimo:  mkdir -p $AOS_HOME/souls/teste/sources && echo '# teste' > $AOS_HOME/souls/teste/perfil.md"
  mark_pending "nenhuma soul em $AOS_HOME/souls — nada pra indexar ainda"
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
    mark_done "daemon rodando via PM2"
  else
    mark_pending "PM2 indisponível — daemon não foi iniciado"
  fi
else
  info "para subir manualmente:"
  printf '     %snpm run os daemon%s        # foreground, porta %s\n' "$BOLD" "$RST" "$PORT"
  printf '     %spm2 start ecosystem.config.cjs%s   # em background\n' "$BOLD" "$RST"
  mark_pending "daemon ainda não iniciado — rode 'npm run os daemon' ou 'pm2 start ecosystem.config.cjs'"
fi

# =============================================================================
step "Resumo"
if [ "${#REPORT_DONE[@]}" -gt 0 ]; then
  say "  ${BOLD}${GRN}Feito:${RST}"
  for item in "${REPORT_DONE[@]}"; do printf '    %s✓%s %s\n' "$GRN" "$RST" "$item"; done
fi
if [ "${#REPORT_PENDING[@]}" -gt 0 ]; then
  say ""
  say "  ${BOLD}${YLW}Pendente / degradado:${RST}"
  for item in "${REPORT_PENDING[@]}"; do printf '    %s!%s %s\n' "$YLW" "$RST" "$item"; done
  say ""
  info "nada aqui bloqueia o uso — são degradações conhecidas (ex.: tier 'local' cai pra 'zen' sem Ollama). Rode ./scripts/setup.sh de novo quando resolver algum item."
else
  say ""
  ok "nada pendente — instalação completa."
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
