# Arquitetura de Pipeline RAG com MCP

Source ID: 6aadda9f-82a7-4cc9-9dc4-bf8efcd92d0d
Title: Arquitetura de Pipeline RAG com MCP
Created: 2026-08-22T03:44:10+00:00
Kind: gemini_chat
Status: ready
Char Count: 5712

---

Timestamp
: 2026-08-22 03:43:48
User
:
 
Mostre uma arquitetura técnica detalhada para um pipeline de RAG integrando MCP, banco vetorial e backend.
Gemini
:
 
Uma arquitetura robusta de RAG integrando MCP (Model Context Protocol), Banco Vetorial e Backend desacopla a ingestão, a recuperação semântica e a execução do agente em camadas modulares[cite: 1, 2, 4]. O pipeline opera sob o princípio 
Local-First
, onde arquivos Markdown canônicos funcionam como a fonte da verdade e o banco relacional/vetorial atua como índice derivado de alta performance[cite: 2, 5, 13].

--------------------------------------------------------------------------------

Visão Geral da Arquitetura
  ┌──────────────────────────────────────────────────────────┐
  │                 CLIENTES & INTERFACES                     │
  │    Claude Code / OpenCode / Cursor / Web / Webhooks       │
  └─────────────────────────┬────────────────────────────────┘
                            │ JSON-RPC (STDIO / HTTP / SSE)
                            ▼
  ┌──────────────────────────────────────────────────────────┐
  │                 MCP SERVER & GATEWAY                     │
  │  - Two-Tier Authorization (Identity Scoping / Allowlists)│
  │  - Tool Registry: memory_search, ingest, record_lesson   │
  │  - Audit Trail & Telemetria ISO/IEC 42001                │
  └─────────────────────────┬────────────────────────────────┘
                            │ Chamada de Serviço / IPC
                            ▼
  ┌──────────────────────────────────────────────────────────┐
  │                   BACKEND / DAEMON                       │
  │  ┌──────────────────────┐      ┌──────────────────────┐  │
  │  │ Orquestrador / Graph │◄────►│ Pipeline de Ingestão │  │
  │  │ (LangGraph / LCEL)   │      │ (Chunking Semântico) │  │
  │  └──────────┬───────────┘      └──────────┬───────────┘  │
  └─────────────┼─────────────────────────────┼──────────────┘
                │ SQL / pgvector / Embeddings │
                ▼                             ▼
  ┌──────────────────────────────────────────────────────────┐
  │                 CAMADA DE PERSISTÊNCIA                    │
  │  - PostgreSQL + pgvector (Índice Semântico Derivado)     │
  │  - Local-First Filesystem (Markdown: ADRs, Sessões, Alma)│
  │  - SQLite (Checkpoints locais e Fallback de Edge)        │
  └──────────────────────────────────────────────────────────┘


--------------------------------------------------------------------------------

Componentes Técnicos Detalhados
1. Protocolo MCP (Model Context Protocol)
Interface Unificada:
 Expõe ferramentas padronizadas (
memory_search
, 
anotar_decisao
, 
buscar_rag
) via JSON-RPC/STDIO para que agentes (Claude, OpenCode ou Hermes) consumam contexto dinamicamente sem poluir a janela de tokens[cite: 1, 2, 10].
Two-Tier Enforcement & Identity Scoping:
 O gateway MCP valida a permissão da persona ativa (
Soul
) através de 
allowlists
 estritas (ex.: 
memory:*
, 
soul_context
), bloqueando ferramentas não autorizadas e reduzindo a carga de schemas enviados ao LLM[cite: 15, 16].
Auditoria ISO/IEC 42001:
 Rastreabilidade e telemetria de consumo (
usage_metadata
: prompt tokens, latency) anexadas a cada execução de ferramenta[cite: 2, 14, 15].
2. Backend & Motor de Orquestração
Ingestão & Chunking Semântico:
 Processadores como 
MarkdownHeaderTextSplitter
 e loaders para transcrições e e-mails que preservam a hierarquia lógica dos documentos antes da vetorização[cite: 1, 5, 10].
Orquestrador de Estados (LangGraph / LCEL):
 Ciclos determinísticos com nós de recuperação e geração, suportando nós discriminadores (
Actor-Critic
) que exigem nota de corte mínima (
\ge 95/100
) e guardrail de limite de iterações (
maxIterations = 5
) para evitar execuções infinitas[cite: 1, 15, 18, 21].
Pre/Post-Retrieval (Reranking e RRF):
 Combinação de busca léxica (Full-Text/BM25) e vetorial com 
Reciprocal Rank Fusion
 e nota de corte mínima de relevância (ex.: score 
\ge 0.70
)[cite: 2, 10].
3. Banco Vetorial & Camada de Armazenamento
PostgreSQL + pgvector:
 Armazena vetores derivados, metadados contextuais (autor, data, módulo, tags) e permite buscas híbridas altamente concorrentes em infraestrutura de time[cite: 1, 2, 10].
Fonte Canônica em Markdown:
 Arquivos locais (
perfil.md
, 
licoes.md
, 
decisoes/
) garantem persistência resiliente, permitindo reconstrução total do índice mesmo com banco indisponível[cite: 2, 5, 13].
SQLite + sqlite-vec (Fallback / Edge):
 Alternativa 
in-process
 para ambientes locais desacoplados e dispositivos físicos[cite: 1, 5, 12].

--------------------------------------------------------------------------------

Fluxo de Execução do Pipeline (Passo a Passo)
Etapa
Responsável
Ação Técnica
1. Solicitação
Cliente MCP / IDE
Agente detecta necessidade de dados e dispara a tool 
memory_search(query)
 via JSON-RPC[cite: 1, 2].
2. Autorização
Camada MCP Server
Valida 
allowlist
 da Soul e registra entrada na trilha de auditoria ISO 42001[cite: 14, 15].
3. Embedding
Backend / LLM Local
Converte a 
query
 em vetor de alta dimensão via endpoint de embedding (ex.: Ollama / OpenAI)[cite: 1, 2, 7].
4. Busca Híbrida
PostgreSQL / pgvector
Executa query KNN (similaridade de cosseno) combinada com filtros SQL de metadados e FTS[cite: 1, 7, 10].
5. Filtragem
Backend / Evaluator
Aplica nota de corte (score 
\ge 0.70
) e formata os top-
k
 chunks com citação de fonte[cite: 1, 10].
6. Resposta & Log
MCP Server 
\rightarrow
 Agente
Devolve o contexto formatado ao agente e persiste telemetria e lições no log diário em Markdown[cite: 1, 2, 15].
Deseja o detalhamento da implementação do servidor MCP em TypeScript ou da cadeia de consulta SQL/pgvector no backend[cite: 1, 5]?