# Provedores Gratuitos para Assistente OS

Este documento lista todos os provedores de IA gratuitos disponíveis através do OmniRoute e como registrá-los no assistente-os. Atualmente o projeto usa 7 providers Zen customizados, mas podem ser expandidos para 56+ "free forever" providers do OmniRoute.

---

## 🆓 **Free Forever - Nenhum token/chave necessário**

| Provedor | Models | Como conectar no assistente-os |
|----------|--------|-------------------------------|
| **OpenCode Zen** | 6 modelos de coding | **Já vem configurado!** - Os 7 providers `zen-*` no `.assistant-os/.env` já usam OpenCode Zen. Chaves: `ZEN_*_API_KEY`. Modelo padrão: `nemotron-3-ultra-free`. |
| **Pollinations** | GPT-5, Claude, Gemini, DeepSeek, Llama 4 | Acesso via web direto. No OmniRoute: dashboard → Connect → Pollinations → "No key needed". No assistente-os: pode ser integrado como provider HTTP direto. |

---

## 🔑 **Precisam de token/API key (free tier)**

### 1. **Kiro AI** - 50 créditos/mês (Claude models)

**Registro:**
1. Acesse: <https://kiro.ai>
2. Faça login com **AWS Builder ID** ou **Google/GitHub**
3. No dashboard OmniRoute: *Providers → Add Provider → Kiro AI*
4. OAuth flow automático - não precisa de chave manual
5. No assistente-os: integrar endpoint OAuth ou usar chave gerada

**Uso no assistente-os:**
- Prefixo sugerido: `kr/`
- Exemplos: `kr/claude-sonnet-4.5`, `kr/claude-haiku-4.5`, `kr/claude-opus-4.6`
- Cota: 50 créditos/mês (reseta ciclo de faturamento)
- **⚠️ ToS warning**: FAQ explicitamente proíbe uso com "OpenClaw e similares que leveram third-party harnesses" - self-hosted AI proxy (risco de banimento)

---

### 2. **Qoder** - 8 modelos free (coding focus)

**Registro:**
1. Registre em: <https://qoder.com>
2. Gere API key na conta
3. No dashboard OmniRoute: *Providers → Add Provider → Qoder*
4. Insira a API key gerada
5. No assistente-os: adicionar provider com auth type "apikey"

**Uso no assistente-os:**
- Prefixo sugerido: `if/`
- Exemplos: `if/qwen3-coder-plus`, `if/kimi-k2`, `if/deepseek-r1`
- Models: Kimi-K2, DeepSeek-R1, Qwen3 variants (coder tasks)
- Cota: "Unlimited" para modelos basic, daily-capped unspecified

**⚠️ Observação:** Qoder é "coding IDE client (not a public API)" - third-party proxy wrappers podem falhar. ToS page returned no readable content.

---

### 3. **LongCat** - 50M tokens/dia (backup)

**Registro:**
1. Acesse: <https://longcat.io/cloud>
2. **Cadastre-se** (necessário **KYC/verificação de identidade**)
3. Gere API key na dashboard
4. No dashboard OmniRoute: *Providers → Add Provider → LongCat*
5. Insira a API key
6. No assistente-os: adicionar provider com auth type "apikey"

**Uso no assistente-os:**
- Modelo: `longcat/flash-lite` ou similar
- Cota: 50M tokens (uma única concessão on-signup, **não recorrente diária/mensal**)
- Best for: "one-off free allowance; pay-as-you-go beyond it"

---

### 4. **SiliconFlow** - núcleos gratuitos ilimitados

**Registro:**
1. Registre em: <https://siliconflow.com>
2. Gere API key na dashboard
3. No dashboard OmniRoute: *Providers → Add Provider → SiliconFlow*
4. Insira a API key

**Uso no assistente-os:**
- Models: Qwen3 variants, DeepSeek, Llama, etc.
- Cota: "Permanently free, no token cap" - rate/concurrency-limited apenas
- Caution: "counting them at RPM×24/7 is the inflation we reject"

---

### 5. **Z.AI GLM-Flash** - GLM models grátis

**Registro:**
1. Registre em: <https://open.bigmodel.cn> (Z.AI / Zhipu)
2. Gere API key
3. No dashboard OmniRoute: *Providers → Add Provider → Z.AI*
4. Insira a API key

**Uso no assistente-os:**
- Models: `glm-4-flash`, `glm-4.5-flash`, `glm-4.7-flash`
- **⚠️ ToS**: Terms de serviço podem ter restrições - verificar antes de usar em produção
- Bonus: 20M tokens signup credit

---

### 6. **Kilo** - tier gratuita, sem cap

**Registro:**
1. Registre em: <https://kilo.ai> ou similar
2. Crie conta
3. No dashboard OmniRoute: *Providers → Add Provider → Kilo*
4. Use credenciais da conta

**Uso no assistente-os:**
- Prefixo: `kilo/` ou similar
- Cota: "Free tier, no token cap" - rate/concurrency-limited
- Models: NVIDIA Nemotron 3 family, StepFun, Poolside, Nex-N2-Pro

---

## 💳 **Free Tier - Requer cadastro + possivelmente créditos**

### 7. **OpenRouter** - +24M tokens/mo com $10 top-up

**Registro:**
1. Registre em: <https://openrouter.ai>
2. Gere API key (gratuita inicialmente)
3. **Para +24M tokens/mo**: faça $10 top-up
4. No assistente-os: adicionar provider com auth type "apikey"

**Combo estratégico (prioridade):**
1. Groq (30 RPM, muito rápido)
2. Cerebras (1M tokens/dia, fast wafer-scale)
3. Mistral (1B tokens/mês, large selection)
4. Google Gemini (1M context, multimodal)
5. NVIDIA NIM (129 modelos, 40 RPM)
6. OpenRouter:free models (fallback último recurso)

**Cota combinada estimada**: ~31,000+ RPD + ~32B+ tokens/mês

---

### 8. **Groq** - 30 RPM, muito rápido

**Registro:**
1. Registre em: <https://console.groq.com>
2. Gere API key (gratuita - 30 RPM)
3. No assistente-os: adicionar provider com auth type "apikey"

**Uso:**
- Models: `groq/llama-4-scout`, `groq/mixtral`, `groq/llama-3.3-70b`
- Cota: 30 RPM (requests per minute), per-model daily caps (até 14.4K RPD / 500K TPD)

---

### 9. **Google AI Studio / Gemini** - 1.500 req/dia grátis

**Registro:**
1. Registre em: <https://aistudio.google.com>
2. Crie chave API
3. No assistente-os: adicionar provider com auth type "apikey"

**Uso:**
- Models: `gemini-1.5-pro`, `gemini-1.5-flash`, `gemini-1.5-flash-8b`
- Cota: 1,500 req/dia free (limites diários)

---

### 10. **DeepSeek** - 5M tokens grátis

**Registro:**
1. Registre em: <https://platform.deepseek.com>
2. Gere API key
3. No assistente-os: adicionar provider com auth type "apikey"

**Uso:**
- Models: `deepseek-coder-v2`, `deepseek-v3`, `deepseek-r1`
- Cota: 5M tokens grátis (uma vez, pode ter validade)

---

### 11. **NVIDIA NIM** - ~40 RPM, 129 modelos

**Registro:**
1. Registre em: <https://build.nvidia.com>
2. Crie conta/key
3. No assistente-os: adicionar provider com auth type "apikey"

**Uso:**
- Models: 129 modelos hosted (incluem Claude, Gemini, Llama variants)
- Cota: ~40 RPM

---

### 12. **Cerebras** - 1M tokens/dia

**Registro:**
1. Registre em: <https://cerebras.ai>
2. Crie conta/key
3. No assistente-os: adicionar provider com auth type "apikey"

**Uso:**
- Models: Qwen3 235B, GPT-OSS 120B, etc.
- Cota: 1M tokens/dia no free trial

---

## ⛔ **Não recomendados / Avoid**

| Provedor | Motivo |
|----------|--------|
| **qwen-web** | "Session-token access against chat.qwen.ai is not dependable free-provider path" - **discontinuado em abril/2026** |
| **qoder** (em certos contexts) | "Coding IDE client (not a public API)" - third-party proxy wrappers podem falhar |
| **Kiro** (em certos contexts) | ToS proíbe third-party harnesses tipo OmniRoute |
| **19 free providers** | ToS prohibem proxy/non-personal use (agy, amazon-q, qwen-web, blackbox, fireworks, etc.) |

---

## 📊 **Combo Estratégico Recomendado** (máximo free)

```
Priority order (combo "priority" strategy):
1. kr/claude-sonnet-4.5        (Kiro AI - 50 créditos/mês)
2. qwen3-coder-plus/flash      (Qwen - unlimited, no auth)
3. if/qwen3-coder-plus         (Qoder - unlimited, no auth)
4. glm-4-flash                  (Z.AI - free tier)
5. groq/llama-4-scout          (Groq - 30 RPM, muito rápido)
6. cerebras/qwen3-235b         (Cerebras - 1M tokens/dia)
7. openrouter:free models      (fallback último recurso)
```

**Economia estimada**: ~1.5B tokens/mês em free tier + compressão RTK+Caveman (15-95% de ahorro de tokens).

---

## 📦 **Integração no assistente-os** (planning only - read-only mode atualmente)

### Passos para implementação futura:

1. **Criar adapters layer** para cada provider no `packages/core/src/router.ts`
2. **Atualizar `.env`** com as chaves API geradas
3. **Migrar os 7 providers zen-*** para usar a nova arquitetura de provider
4. **Implementar combo strategies** (priority, weighted, round-robin, cost-optimized)
5. **Adicionar quota tracking** inspirado no `cost_calls` do kernel.db
6. **Criar dashboard health** com métricas similares ao OmniRoute (uptime, latency p50/p95/p99, circuit breaker states)

### Arquivos afetados (futuro):
- `packages/core/src/router.ts` - rotação de providers
- `packages/core/.env` - chaves API novas
- `packages/core/src/costs.ts` - tracking de custo expandido
- `packages/core/src/index.ts` - nova endpoint de status de providers

---

## 🔧 **Comandos úteis** (depois da implementação)

```bash
# Listar souls disponíveis
node packages/cli/dist/index.js souls

# Custos atuais
node packages/cli/dist/index.js costs

# Graph do grafo
node packages/cli/dist/index.js graph list

# Status do roteador
node packages/cli/dist/index.js router status
```

---

*Documento gerado em 2026-08-15. Para atualizações de provedores, consultar docs/reference/FREE_TIERS.md do OmniRoute semanalmente (catálogo é re-auditado a cada 2 semanas).*