#!/bin/bash
# Script de teste HTTP REST para o agente LangGraph com tool-calling.
#
# Uso:
#   ./test-langgraph-tools.sh                    # testa contra localhost:4310
#   ./test-langgraph-tools.sh https://meu-app.com # testa contra URL customizada
#
# Requer: daemon rodando, Ollama disponível.

set -euo pipefail

BASE="${1:-http://127.0.0.1:4310}"
TOKEN="${AOS_TOKEN:-}"
PASS=0
FAIL=0

pass() { echo "  ✔ $1"; ((PASS++)); }
fail() { echo "  ✖ $1"; ((FAIL++)); }

auth() {
  if [ -n "$TOKEN" ]; then
    echo "-H Authorization:Bearer $TOKEN"
  fi
}

echo "=== LangGraph tool-calling REST tests ==="
echo "Target: $BASE"
echo ""

# 1. Health
echo "1. health check"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/health" $(auth))
[ "$STATUS" = "200" ] && pass "health 200" || fail "health $STATUS"

# 2. LangGraph tier sem tools
echo "2. langGraph sem tools"
R=$(curl -s -X POST "$BASE/souls/main/chat" \
  -H "Content-Type: application/json" \
  $(auth) \
  -d '{"prompt":"Diga apenas: ok","tier":"langgraph"}')
OK=$(echo "$R" | jq -r '.ok // empty')
TEXT=$(echo "$R" | jq -r '.text // empty')
PROVIDER=$(echo "$R" | jq -r '.provider // empty')
[ "$OK" = "true" ] && pass "ok=true" || fail "ok=$OK"
[ -n "$TEXT" ] && pass "text presente" || fail "text vazio"
[ "$PROVIDER" = "langgraph" ] && pass "provider=langgraph" || fail "provider=$PROVIDER"

# 3. LangGraph com memory_search
echo "3. langGraph com memory_search"
R=$(curl -s -X POST "$BASE/souls/main/chat" \
  -H "Content-Type: application/json" \
  $(auth) \
  -d '{"prompt":"Use a tool memory_search para buscar por assistente na memoria. Resuma.","tier":"langgraph"}')
OK=$(echo "$R" | jq -r '.ok // empty')
[ "$OK" = "true" ] && pass "memory_search ok" || fail "memory_search ok=$OK"

# 4. LangGraph com memory_status
echo "4. langGraph com memory_status"
R=$(curl -s -X POST "$BASE/souls/main/chat" \
  -H "Content-Type: application/json" \
  $(auth) \
  -d '{"prompt":"Use a tool memory_status para verificar o status da memoria.","tier":"langgraph"}')
OK=$(echo "$R" | jq -r '.ok // empty')
[ "$OK" = "true" ] && pass "memory_status ok" || fail "memory_status ok=$OK"

# 5. LangGraph com graph_list
echo "5. langGraph com graph_list"
R=$(curl -s -X POST "$BASE/souls/main/chat" \
  -H "Content-Type: application/json" \
  $(auth) \
  -d '{"prompt":"Use a tool graph_list para listar entidades do grafo.","tier":"langgraph"}')
OK=$(echo "$R" | jq -r '.ok // empty')
[ "$OK" = "true" ] && pass "graph_list ok" || fail "graph_list ok=$OK"

# 6. LangGraph com soul_anotar
echo "6. langGraph com soul_anotar"
R=$(curl -s -X POST "$BASE/souls/main/chat" \
  -H "Content-Type: application/json" \
  $(auth) \
  -d "{\"prompt\":\"Use a tool soul_anotar para anotar: Teste tool-calling $(date -Iseconds)\",\"tier\":\"langgraph\"}")
OK=$(echo "$R" | jq -r '.ok // empty')
[ "$OK" = "true" ] && pass "soul_anotar ok" || fail "soul_anotar ok=$OK"

# 7. LangGraph com soul_licao
echo "7. langGraph com soul_licao"
R=$(curl -s -X POST "$BASE/souls/main/chat" \
  -H "Content-Type: application/json" \
  $(auth) \
  -d '{"prompt":"Use a tool soul_licao para registrar: Tool-calling funciona via LangGraph","tier":"langgraph"}')
OK=$(echo "$R" | jq -r '.ok // empty')
[ "$OK" = "true" ] && pass "soul_licao ok" || fail "soul_licao ok=$OK"

# 8. LangGraph com costs_summary
echo "8. langGraph com costs_summary"
R=$(curl -s -X POST "$BASE/souls/main/chat" \
  -H "Content-Type: application/json" \
  $(auth) \
  -d '{"prompt":"Use a tool costs_summary para verificar custos.","tier":"langgraph"}')
OK=$(echo "$R" | jq -r '.ok // empty')
[ "$OK" = "true" ] && pass "costs_summary ok" || fail "costs_summary ok=$OK"

# 9. LangGraph com agenda_list
echo "9. langGraph com agenda_list"
R=$(curl -s -X POST "$BASE/souls/main/chat" \
  -H "Content-Type: application/json" \
  $(auth) \
  -d '{"prompt":"Use a tool agenda_list para listar tarefas pendentes.","tier":"langgraph"}')
OK=$(echo "$R" | jq -r '.ok // empty')
[ "$OK" = "true" ] && pass "agenda_list ok" || fail "agenda_list ok=$OK"

# 10. LangGraph com agenda_add
echo "10. langGraph com agenda_add"
R=$(curl -s -X POST "$BASE/souls/main/chat" \
  -H "Content-Type: application/json" \
  $(auth) \
  -d '{"prompt":"Use a tool agenda_add para criar tarefa: Teste LangGraph tool-calling.","tier":"langgraph"}')
OK=$(echo "$R" | jq -r '.ok // empty')
[ "$OK" = "true" ] && pass "agenda_add ok" || fail "agenda_add ok=$OK"

# 11. LangGraph com memoria persistente (thread)
echo "11. langGraph memoria persistente (thread)"
THREAD="test-thread-$(date +%s)"
R1=$(curl -s -X POST "$BASE/souls/main/chat" \
  -H "Content-Type: application/json" \
  $(auth) \
  -d "{\"prompt\":\"Lembre que o numero secreto e 42.\",\"tier\":\"langgraph\",\"threadId\":\"$THREAD\"}")
OK1=$(echo "$R1" | jq -r '.ok // empty')
R2=$(curl -s -X POST "$BASE/souls/main/chat" \
  -H "Content-Type: application/json" \
  $(auth) \
  -d "{\"prompt\":\"Qual e o numero secreto?\",\"tier\":\"langgraph\",\"threadId\":\"$THREAD\"}")
TEXT2=$(echo "$R2" | jq -r '.text // empty')
echo "$TEXT2" | grep -q "42" && pass "thread lembra 42" || fail "thread nao lembrou (text: $TEXT2)"

# 12. Soul inexistente
echo "12. soul inexistente retorna erro"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/souls/nao-existe/chat" \
  -H "Content-Type: application/json" \
  $(auth) \
  -d '{"prompt":"Oi","tier":"langgraph"}')
[ "$STATUS" -ge 400 ] && pass "4xx para soul inexistente" || fail "status=$STATUS"

# Resumo
echo ""
echo "=== Resultado: $PASS passaram, $FAIL falharam ==="
[ "$FAIL" -eq 0 ] && echo "✔ Todos os testes passaram!" || echo "✖ Alguns testes falharam."
exit $FAIL
