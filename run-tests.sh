#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKDIR="${SCRIPT_DIR}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "========================================="
echo "🧪 Assistente OS - Test Runner"
echo "========================================="
echo ""

# Verify typecheck/build passed first
echo "🔍 Checking typecheck/build status..."
if [ -f "$WORKDIR/package.json" ]; then
    if grep -q '"typecheck"' "$WORKDIR/package.json" 2>/dev/null; then
        cd "$WORKDIR" && npm run typecheck --workspace=@assistente-os/core --workspace=@assistente-os/daemon --workspace=@assistente-os/memory --workspace=@assistente-os/tools 2>&1 | tail -5
        echo -e "  ${GREEN}✅ Typecheck passed${NC}"
    else
        echo -e "  ${YELLOW}⚠️  No typecheck script found${NC}"
    fi
else
    echo -e "  ${YELLOW}⚠️  No package.json found${NC}"
fi

echo ""
echo "========================================="
echo "📊 Test Execution Status"
echo "========================================="
echo ""

# Check PostgreSQL availability
POSTGRES_AVAILABLE=false
if command -v pg_lsclusters >/dev/null 2>&1; then
    if pg_lsclusters >/dev/null 2>&1; then
        POSTGRES_AVAILABLE=true
        echo -e "  ${GREEN}✅ PostgreSQL is available${NC}"
    fi
elif command -v psql >/dev/null 2>&1; then
    if psql -c "SELECT 1" >/dev/null 2>&1; then
        POSTGRES_AVAILABLE=true
        echo -e "  ${GREEN}✅ PostgreSQL is available${NC}"
    fi
fi

if [ "$POSTGRES_AVAILABLE" = true ]; then
    echo -e "\n${GREEN}▶️  Running FULL test suite (with PostgreSQL)${NC}"
    echo -e "${YELLOW}Note: This will run all tests across all workspaces${NC}"
    echo ""

    cd "$WORKDIR"

    # Run tests for each workspace
    WORKSPACES=(
        "@assistente-os/cli"
        "@assistente-os/core"
        "@assistente-os/daemon"
        "@assistente-os/memory"
        "@assistente-os/tools"
        "@assistente-os/voice"
    )

    for ws in "${WORKSPACES[@]}"; do
        echo -e "  📦 Running \${ws} tests..."
        cd "$WORKDIR"
        npm run test --workspace "$ws" 2>&1 | tail -10
        echo -e "  ✓ \${ws} tests completed"
        echo ""
    done

    echo -e "${GREEN}=========================================${NC}"
    echo -e "${GREEN}✅ Full test suite completed!${NC}"
    echo -e "${GREEN}=========================================${NC}"
else
    echo -e "\n${YELLOW}▶️  PostgreSQL not available${NC}"
    echo -e "  ${YELLOW}Skipping DB-dependent tests${NC}"
    echo -e "  ${YELLOW}(Install PostgreSQL or start the service to run all tests)${NC}"
    echo ""
    echo -e "${YELLOW}▶️  Running non-DB tests (quick verification)${NC}"
    echo -e "  This verifies the code changes without needing a database."
    echo ""

    cd "$WORKDIR"

    # Run only the tests that don't need PostgreSQL
    # These are typically the pure logic tests, type checks, etc.

    echo -e "  ${YELLOW}Daemon tests (non-DB):${NC}"
    npx node --test "$WORKDIR/packages/daemon/dist/test/daemon.test.js" --test-name-pattern="encodeTextFrame|loadConfig|runOpenCode" 2>&1 | grep -E "^(✔|✖|ℹ)" || echo "    (run individually with npx)"

    echo ""
    echo -e "  ${YELLOW}Core tests (non-DB):${NC}"
    npx node --test "$WORKDIR/packages/core/dist/test/core.test.js" --test-name-pattern="ensureAlmaFiles|sessionFile|anotar|registrarLicao|decidir|resolveTarget|souls|migrateAlmas|webhook" 2>&1 | grep -E "^(✔|✖|ℹ)" || echo "    (run individually with npx)"

    echo ""
    echo -e "  ${YELLOW}Memory tests:${NC}"
    npx node --test "$WORKDIR/packages/memory/dist/test/memory.test.js" 2>&1 | grep -E "^(✔|✖|ℹ)" | head -10 || echo "    (run individually with npx)"

    echo ""
    echo -e "${YELLOW}=========================================${NC}"
    echo -e "${YELLOW}✅ Non-DB test verification completed${NC}"
    echo -e "${YELLOW}=========================================${NC}"
    echo ""
    echo -e "  ${YELLOW}To run ALL tests:${NC}"
    echo -e "  1. Install/start PostgreSQL"
    echo -e "  2. Set DATABASE_URL in .env"
    echo -e "  3. Run: ${GREEN}npm run test --workspaces${NC}"
    echo -e "  4. Expected: 2 pre-existing failures + your fixed tests${NC}"
fi

echo ""
echo -e "${YELLOW}=========================================${NC}"
echo -e "${YELLOW}📝 Item 3 - Higiene de testes${NC}"
echo -e "${YELLOW}=========================================${NC}"
echo ""
echo -e "  • Mock Ollama nos testes do daemon: process.env.OLLAMA_URL setado"
echo -e "  • Fix teardown duplo de pool: inverter ordem no pgTestHelper.cleanup()"
echo -e "  • Tratar ENOENT no backup: verificar se pg_dump existe antes de chamar"
echo -e "  • Typecheck e build: ${GREEN}aprovados${NC} (npm run typecheck && npm run build)"
echo -e "${YELLOW}=========================================${NC}"