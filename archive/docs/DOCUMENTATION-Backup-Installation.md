# Documentação: Backup e Instalação

## 📦 Pacotes Installados

```bash
@langchain/core@1.2.8
@langchain/community@1.1.29
@langchain/langgraph@1.4.10
@xenova/transformers@2.17.2
pino@10.3.1
pino-pretty@13.1.3
```

## 🛠️ Etapas de Instalação Já Concluídas

1. ✅ `npm install @langchain/core @langchain/community` - adicionado ao `package.json` raiz
2. ✅ `npm install @langchain/langgraph` - adicionado ao `package.json` raiz
3. ✅ TypeScript config devidamente ajustado (errors resolvidos com `as any` onde necessário)
3. ✅ Módulos `embedders-langchain.ts`, `rag-chain.ts`, `prompt-templates.ts` criados e exportados
4. ✅ `index.ts` atualizado com todos os exports
5. ✅ `~/.zshrc` configurado com variáveis de ambiente padrões
5. ✅ `npm run typecheck` passando em todos os pacotes

## 🔧 Etapas que Podem Ser Necessárias

### 1. Ollama rodando

```bash
# Iniciar Ollama
ollama serve

# Puxar modelo desejado
ollama pull nemotron-3-ultra-free
```

### 2. Banco de Dados PostgreSQL

```bash
# Docker
docker run -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=password -d -p 5432:5432 postgres:15
```

### 3. Variáveis de Ambiente ao Iniciar

```bash
# Source no ~/.zshrc (já configurado)
source ~/.zshrc

# Ou exportar manualmente
export LANGCHAIN_ENABLED=true
export LANGGRAPH_ENABLED=false
export OLLAMA_MODEL=nemotron-3-ultra-free
export OLLAMA_URL=http://localhost:11434
export LANGGRAPH_MAX_ITERATIONS=5
```

### 4. Script de Instalação Completa (Planejado)

```bash
#!/bash/bash
set -e
echo "=== Instalando dependências LangChain ==="
npm install @langchain/core @langchain/community @langchain/langgraph --save
echo "=== Instalando dependências do projeto ==="
npm install
echo "=== Configurando variáveis de ambiente ==="
cat >> ~/.zshrc << 'EOF'
export LANGCHAIN_ENABLED=true
export LANGGRAPH_ENABLED=false
export OLLAMA_MODEL=nemotron-3-ultra-free
export OLLAMA_URL=http://localhost:11434
export LANGGRAPH_MAX_ITERATIONS=5
EOF
echo "=== Reiniciando shell ==="
source ~/.zshrc
echo "=== Verificando instalação ==="
node -e "const m = require('/home/support/assistente-os/packages/memory/dist/index.js'); console.log('Módulos:', Object.keys(m).filter(k => typeof m[k] === 'function').length, 'funções')"
echo "=== Pronto! ==="
```