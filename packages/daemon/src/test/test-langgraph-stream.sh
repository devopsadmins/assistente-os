#!/bin/bash
# Testes de streaming LangGraph via WebSocket e REST.
#
# Uso:
#   ./test-langgraph-stream.sh                    # testa contra localhost:4310
#   ./test-langgraph-stream.sh https://meu-app.com # testa contra URL customizada
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

echo "=== LangGraph Stream tests ==="
echo "Target: $BASE"
echo ""

# 1. Health
echo "1. health check"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/health" $(auth))
[ "$STATUS" = "200" ] && pass "health 200" || fail "health $STATUS"

# 2. LangGraph status
echo "2. langgraph status"
R=$(curl -s "$BASE/souls/main/langgraph/status" $(auth))
AVAILABLE=$(echo "$R" | jq -r '.available // empty')
OLLAMA=$(echo "$R" | jq -r '.ollamaAvailable // empty')
[ -n "$AVAILABLE" ] && pass "available=$AVAILABLE" || fail "available vazio"
[ -n "$OLLAMA" ] && pass "ollamaAvailable=$OLLAMA" || fail "ollamaAvailable vazio"

# 3. LangGraph history
echo "3. langgraph history"
R=$(curl -s "$BASE/souls/main/langgraph/history" $(auth))
HISTORY=$(echo "$R" | jq -r '.history | length')
[ -n "$HISTORY" ] && pass "history array length=$HISTORY" || fail "history vazio"

# 4. Chat com mode=langgraph
echo "4. chat com tier=langgraph"
R=$(curl -s -X POST "$BASE/souls/main/chat" \
  -H "Content-Type: application/json" \
  $(auth) \
  -d '{"prompt":"Diga apenas: stream ok","tier":"langgraph"}')
OK=$(echo "$R" | jq -r '.ok // empty')
TIER=$(echo "$R" | jq -r '.tier // empty')
TEXT=$(echo "$R" | jq -r '.text // empty')
[ "$OK" = "true" ] && pass "ok=true" || fail "ok=$OK"
[ "$TIER" = "langgraph" ] && pass "tier=langgraph" || fail "tier=$TIER"
[ -n "$TEXT" ] && pass "text presente" || fail "text vazio"

# 5. Chat sem mode (auto)
echo "5. chat sem tier definido (auto)"
R=$(curl -s -X POST "$BASE/souls/main/chat" \
  -H "Content-Type: application/json" \
  $(auth) \
  -d '{"prompt":"Diga apenas: auto ok"}')
OK=$(echo "$R" | jq -r '.ok // empty')
MODE=$(echo "$R" | jq -r '.mode // empty')
[ "$OK" = "true" ] && pass "ok=true" || fail "ok=$OK"
[ -n "$MODE" ] && pass "mode=$MODE" || fail "mode vazio"

# 6. Chat com tier=local
echo "6. chat com tier=local"
R=$(curl -s -X POST "$BASE/souls/main/chat" \
  -H "Content-Type: application/json" \
  $(auth) \
  -d '{"prompt":"Diga apenas: local ok","tier":"local"}')
OK=$(echo "$R" | jq -r '.ok // empty')
TIER=$(echo "$R" | jq -r '.tier // empty')
[ "$OK" = "true" ] && pass "ok=true" || fail "ok=$OK"
[ "$TIER" = "local" ] && pass "tier=local" || fail "tier=$TIER"

# 7. LangGraph com memory_search
echo "7. langgraph com memory_search"
R=$(curl -s -X POST "$BASE/souls/main/chat" \
  -H "Content-Type: application/json" \
  $(auth) \
  -d '{"prompt":"Use a tool memory_search para buscar por assistente na memoria. Resuma.","tier":"langgraph"}')
OK=$(echo "$R" | jq -r '.ok // empty')
[ "$OK" = "true" ] && pass "memory_search ok" || fail "memory_search ok=$OK"

# 8. LangGraph com memory_status
echo "8. langgraph com memory_status"
R=$(curl -s -X POST "$BASE/souls/main/chat" \
  -H "Content-Type: application/json" \
  $(auth) \
  -d '{"prompt":"Use a tool memory_status para verificar o status da memoria.","tier":"langgraph"}')
OK=$(echo "$R" | jq -r '.ok // empty')
[ "$OK" = "true" ] && pass "memory_status ok" || fail "memory_status ok=$OK"

# 9. LangGraph com graph_list
echo "9. langgraph com graph_list"
R=$(curl -s -X POST "$BASE/souls/main/chat" \
  -H "Content-Type: application/json" \
  $(auth) \
  -d '{"prompt":"Use a tool graph_list para listar entidades do grafo.","tier":"langgraph"}')
OK=$(echo "$R" | jq -r '.ok // empty')
[ "$OK" = "true" ] && pass "graph_list ok" || fail "graph_list ok=$OK"

# 10. LangGraph com soul_anotar
echo "10. langgraph com soul_anotar"
R=$(curl -s -X POST "$BASE/souls/main/chat" \
  -H "Content-Type: application/json" \
  $(auth) \
  -d "{\"prompt\":\"Use a tool soul_anotar para anotar: Stream test $(date -Iseconds)\",\"tier\":\"langgraph\"}")
OK=$(echo "$R" | jq -r '.ok // empty')
[ "$OK" = "true" ] && pass "soul_anotar ok" || fail "soul_anotar ok=$OK"

# 11. LangGraph com soul_licao
echo "11. langgraph com soul_licao"
R=$(curl -s -X POST "$BASE/souls/main/chat" \
  -H "Content-Type: application/json" \
  $(auth) \
  -d '{"prompt":"Use a tool soul_licao para registrar: Stream test funciona via LangGraph","tier":"langgraph"}')
OK=$(echo "$R" | jq -r '.ok // empty')
[ "$OK" = "true" ] && pass "soul_licao ok" || fail "soul_licao ok=$OK"

# 12. LangGraph com costs_summary
echo "12. langgraph com costs_summary"
R=$(curl -s -X POST "$BASE/souls/main/chat" \
  -H "Content-Type: application/json" \
  $(auth) \
  -d '{"prompt":"Use a tool costs_summary para verificar custos.","tier":"langgraph"}')
OK=$(echo "$R" | jq -r '.ok // empty')
[ "$OK" = "true" ] && pass "costs_summary ok" || fail "costs_summary ok=$OK"

# 13. LangGraph com agenda_list
echo "13. langgraph com agenda_list"
R=$(curl -s -X POST "$BASE/souls/main/chat" \
  -H "Content-Type: application/json" \
  $(auth) \
  -d '{"prompt":"Use a tool agenda_list para listar tarefas pendentes.","tier":"langgraph"}')
OK=$(echo "$R" | jq -r '.ok // empty')
[ "$OK" = "true" ] && pass "agenda_list ok" || fail "agenda_list ok=$OK"

# 14. LangGraph com agenda_add
echo "14. langgraph com agenda_add"
R=$(curl -s -X POST "$BASE/souls/main/chat" \
  -H "Content-Type: application/json" \
  $(auth) \
  -d '{"prompt":"Use a tool agenda_add para criar tarefa: Stream test item.","tier":"langgraph"}')
OK=$(echo "$R" | jq -r '.ok // empty')
[ "$OK" = "true" ] && pass "agenda_add ok" || fail "agenda_add ok=$OK"

# 15. LangGraph com memória persistente (thread)
echo "15. langgraph memoria persistente (thread)"
THREAD="stream-test-$(date +%s)"
R1=$(curl -s -X POST "$BASE/souls/main/chat" \
  -H "Content-Type: application/json" \
  $(auth) \
  -d "{\"prompt\":\"Lembre que o numero secreto e 88.\",\"tier\":\"langgraph\",\"threadId\":\"$THREAD\"}")
OK1=$(echo "$R1" | jq -r '.ok // empty')
R2=$(curl -s -X POST "$BASE/souls/main/chat" \
  -H "Content-Type: application/json" \
  $(auth) \
  -d "{\"prompt\":\"Qual e o numero secreto?\",\"tier\":\"langgraph\",\"threadId\":\"$THREAD\"}")
TEXT2=$(echo "$R2" | jq -r '.text // empty')
echo "$TEXT2" | grep -q "88" && pass "thread lembra 88" || fail "thread nao lembrou (text: $TEXT2)"

# 16. Soul inexistente
echo "16. soul inexistente retorna erro"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/souls/nao-existe/chat" \
  -H "Content-Type: application/json" \
  $(auth) \
  -d '{"prompt":"Oi","tier":"langgraph"}')
[ "$STATUS" -ge 400 ] && pass "4xx para soul inexistente" || fail "status=$STATUS"

# 17. LangGraph status para soul inexistente
echo "17. langgraph status soul inexistente"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/souls/nao-existe/langgraph/status" $(auth))
[ "$STATUS" -ge 400 ] && pass "4xx para soul inexistente" || fail "status=$STATUS"

# 18. LangGraph history para soul inexistente
echo "18. langgraph history soul inexistente"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/souls/nao-existe/langgraph/history" $(auth))
[ "$STATUS" -ge 400 ] && pass "4xx para soul inexistente" || fail "status=$STATUS"

# Resumo
echo ""
echo "=== Resultado: $PASS passaram, $FAIL falharam ==="
[ "$FAIL" -eq 0 ] && echo "✔ Todos os testes passaram!" || echo "✖ Alguns testes falharam."
exit $FAIL
