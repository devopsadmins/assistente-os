# Graph Report - assistente-os  (2026-08-15)

## Corpus Check
- 52 files · ~44,286 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 509 nodes · 620 edges · 27 communities (26 shown, 1 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 7 edges (avg confidence: 0.86)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `a4c718d1`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Assistente OS Core
- Memory Package
- Documentation
- Daemon Package
- Tools Package
- CLI Package
- Memory Package Config
- Kernel & Scheduler
- Base TypeScript Config
- Core Package Config
- Workspace Config
- Daemon Package Config
- Tools Source / MCP Server
- CLI TypeScript Config
- Daemon TypeScript Config
- Memory TypeScript Config
- Tools TypeScript Config
- CLI Source
- Core TypeScript Config
- Stitch MCP Scripts
- Update cumulative cost tracker
- session-ses_ff97.md
- Saudação inicial
- New session - 2026-08-15T19:13:53.949Z
- standards
- Gerenciador de Especificações e Contexto
- grule.md

## God Nodes (most connected - your core abstractions)
1. `Update cumulative cost tracker` - 35 edges
2. `Saudação inicial` - 33 edges
3. `compilerOptions` - 15 edges
4. `New session - 2026-08-15T19:13:53.949Z` - 10 edges
5. `scripts` - 7 edges
6. `createFullBackup()` - 7 edges
7. `McpServer` - 7 edges
8. `loadConfig()` - 6 edges
9. `Scheduler` - 6 edges
10. `getSoul()` - 6 edges

## Surprising Connections (you probably didn't know these)
- `Local-First Routing Chain` --semantically_similar_to--> `Integrated Local-First Chat Router`  [INFERRED] [semantically similar]
  docs/ARCHITECTURE.md → KB.md
- `Router Integration Backlog Item` --conceptually_related_to--> `Integrated Local-First Chat Router`  [AMBIGUOUS]
  docs/BACKLOG.md → KB.md
- `Assistente OS` --references--> `Assistente OS Architecture`  [EXTRACTED]
  README.md → docs/ARCHITECTURE.md
- `Assistente OS` --references--> `Assistente OS MCP Configuration`  [EXTRACTED]
  README.md → docs/MCPS.md
- `Multi-Zen Provider Configuration` --semantically_similar_to--> `Zen Provider Registry`  [INFERRED] [semantically similar]
  docs/ARCHITECTURE.md → docs/MCPS.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Assistente OS Runtime Stack** — readme_workspace_packages, docs_architecture_runtime_layers, docs_mcps_assistente_os_mcp [EXTRACTED 1.00]
- **Provider Expansion Workstream** — docs_free_providers_omniroute, docs_free_providers_priority_strategy, docs_free_providers_integration_plan, docs_architecture_multi_zen [INFERRED 0.85]

## Communities (27 total, 1 thin omitted)

### Community 0 - "Assistente OS Core"
Cohesion: 0.09
Nodes (37): AssistenteOsConfig, loadConfig(), loadDotEnv(), resolveHome(), CostCall, CostCallInput, nowIso(), recentCalls() (+29 more)

### Community 1 - "Memory Package"
Cohesion: 0.09
Nodes (25): cosine(), Embedder, LiteralEmbedder, OllamaEmbedder, addObservation(), Entity, graphStats(), listEntities() (+17 more)

### Community 2 - "Documentation"
Cohesion: 0.08
Nodes (29): kernel.db, Local-First Routing Chain, memory.db, Multi-Zen Provider Configuration, Daemon, Kernel, Memory, MCP, and CLI Layers, Stitch MCP Wrapper, Assistente OS Architecture, Assistente OS Backlog (+21 more)

### Community 3 - "Daemon Package"
Cohesion: 0.12
Nodes (18): RFC-6455, config, port, OpenCodeRunOptions, OpenCodeRunResult, resolveOpenCodeBin(), runOpenCode(), DaemonHandle (+10 more)

### Community 4 - "Tools Package"
Cohesion: 0.07
Nodes (26): @google/stitch-sdk, bin, os-mcp, dependencies, @assistente-os/core, @assistente-os/daemon, @assistente-os/memory, @google/stitch-sdk (+18 more)

### Community 5 - "CLI Package"
Cohesion: 0.08
Nodes (24): archiver, bin, os, dependencies, archiver, @assistente-os/core, @assistente-os/daemon, @assistente-os/memory (+16 more)

### Community 6 - "Memory Package Config"
Cohesion: 0.11
Nodes (18): dependencies, @assistente-os/core, devDependencies, @types/node, typescript, @assistente-os/core, @types/node, typescript (+10 more)

### Community 7 - "Kernel & Scheduler"
Cohesion: 0.22
Nodes (8): AgendaItem, getAgendaItems(), KernelDb, markAgendaDone(), openKernelDb(), findOpencodeExe(), Scheduler, SchedulerRunOptions

### Community 8 - "Base TypeScript Config"
Cohesion: 0.12
Nodes (16): ES2023, compilerOptions, composite, declaration, esModuleInterop, forceConsistentCasingInFileNames, lib, module (+8 more)

### Community 9 - "Core Package Config"
Cohesion: 0.12
Nodes (15): devDependencies, @types/node, typescript, @types/node, typescript, main, name, private (+7 more)

### Community 10 - "Workspace Config"
Cohesion: 0.11
Nodes (18): http-server, devDependencies, http-server, engines, node, name, private, scripts (+10 more)

### Community 11 - "Daemon Package Config"
Cohesion: 0.14
Nodes (13): dependencies, @assistente-os/core, @assistente-os/core, main, name, private, scripts, build (+5 more)

### Community 12 - "Tools Source / MCP Server"
Cohesion: 0.23
Nodes (5): McpServer, McpServerOptions, startStdio(), Tool, TOOLS

### Community 13 - "CLI TypeScript Config"
Cohesion: 0.22
Nodes (8): compilerOptions, composite, outDir, rootDir, extends, include, src, ../../tsconfig.base.json

### Community 14 - "Daemon TypeScript Config"
Cohesion: 0.22
Nodes (8): compilerOptions, composite, outDir, rootDir, extends, include, src, ../../tsconfig.base.json

### Community 15 - "Memory TypeScript Config"
Cohesion: 0.22
Nodes (8): compilerOptions, outDir, rootDir, extends, include, src/**/*.ts, ../../tsconfig.base.json, references

### Community 16 - "Tools TypeScript Config"
Cohesion: 0.22
Nodes (8): compilerOptions, composite, outDir, rootDir, extends, include, src, ../../tsconfig.base.json

### Community 17 - "CLI Source"
Cohesion: 0.39
Nodes (6): BackupResult, createFullBackup(), isPreviousBackup(), isSidecarOfSnapshotDatabase(), stageEntry(), main()

### Community 18 - "Core TypeScript Config"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 19 - "Stitch MCP Scripts"
Cohesion: 0.50
Nodes (3): envFiles, proxy, transport

### Community 20 - "Update cumulative cost tracker"
Cohesion: 0.05
Nodes (38): Assistant (Build · Nemotron 3 Ultra Free · 10.2s), Assistant (Build · Nemotron 3 Ultra Free · 10.3s), Assistant (Build · Nemotron 3 Ultra Free · 11.5s), Assistant (Build · Nemotron 3 Ultra Free · 11.6s), Assistant (Build · Nemotron 3 Ultra Free · 12.4s), Assistant (Build · Nemotron 3 Ultra Free · 12.5s), Assistant (Build · Nemotron 3 Ultra Free · 13.6s), Assistant (Build · Nemotron 3 Ultra Free · 13.6s) (+30 more)

### Community 21 - "session-ses_ff97.md"
Cohesion: 0.06
Nodes (35): Always (re)write the cache file: write hits, else DELETE any leftover from a prior, Assistant (Build · Nemotron 3 Ultra Free · 21.2s), base so the full build and incremental --update never drift apart on re-extract., by the AST pass (Part A); flattening every category here makes subagents re-read, Detect Python with graphify — uv/pipx-aware (fixes #831), every source file (#1392). Video is transcribed to a document in Step 2.5 first., Export FIRST and honor the #479 shrink-guard: to_json returns False (writing, GRAPH_REPORT.md / analysis sidecar. Check immediately after build (#1392). (+27 more)

### Community 22 - "Saudação inicial"
Cohesion: 0.06
Nodes (33): Assistant (Build · Nemotron 3 Ultra (free) · 10.0s), Assistant (Build · Nemotron 3 Ultra (free) · 14.0s), Assistant (Build · Nemotron 3 Ultra (free) · 15.3s), Assistant (Build · Nemotron 3 Ultra (free) · 212.7s), Assistant (Build · Nemotron 3 Ultra (free) · 4.1s), Assistant (Build · Nemotron 3 Ultra (free) · 4.1s), Assistant (Build · Nemotron 3 Ultra (free) · 5.3s), Assistant (Build · Nemotron 3 Ultra (free) · 6.3s) (+25 more)

### Community 23 - "New session - 2026-08-15T19:13:53.949Z"
Cohesion: 0.13
Nodes (14): Assistant (Build · DeepSeek V4 Flash (free) · 20.5s), Assistant (Build · Nemotron 3 Ultra Free · 11.4s), Assistant (Build · Nemotron 3 Ultra Free · 137.8s), Assistant (Build · Nemotron 3 Ultra Free · 140.6s), Assistant (Build · Nemotron 3 Ultra Free · 14.9s), Assistant (Build · Nemotron 3 Ultra Free · 258.2s), New session - 2026-08-15T19:13:53.949Z, Observações: (+6 more)

### Community 24 - "standards"
Cohesion: 0.17
Nodes (11): PYTHONIOENCODING, STANDARDS_REPO_ROOT, mcp, standards, $schema, command, enabled, environment (+3 more)

### Community 25 - "Gerenciador de Especificações e Contexto"
Cohesion: 0.50
Nodes (3): Diretrizes operacionais, Fonte canônica e ferramentas, Gerenciador de Especificações e Contexto

## Ambiguous Edges - Review These
- `Integrated Local-First Chat Router` → `Router Integration Backlog Item`  [AMBIGUOUS]
  docs/BACKLOG.md · relation: conceptually_related_to

## Knowledge Gaps
- **280 isolated node(s):** `$schema`, `type`, `node`, `D:/Projetos/projeto0/mcp/standards-mcp-server/dist/index.js`, `enabled` (+275 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Integrated Local-First Chat Router` and `Router Integration Backlog Item`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `Update cumulative cost tracker` connect `Update cumulative cost tracker` to `session-ses_ff97.md`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **Why does `openKernelDb()` connect `Kernel & Scheduler` to `Assistente OS Core`?**
  _High betweenness centrality (0.002) - this node is a cross-community bridge._
- **What connects `$schema`, `type`, `node` to the rest of the system?**
  _280 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Assistente OS Core` be split into smaller, more focused modules?**
  _Cohesion score 0.09371980676328502 - nodes in this community are weakly interconnected._
- **Should `Memory Package` be split into smaller, more focused modules?**
  _Cohesion score 0.08780487804878048 - nodes in this community are weakly interconnected._
- **Should `Documentation` be split into smaller, more focused modules?**
  _Cohesion score 0.07881773399014778 - nodes in this community are weakly interconnected._