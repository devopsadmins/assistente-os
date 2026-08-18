# Graph Report - D:\Projetos\assistente-os  (2026-08-15)

## Corpus Check
- Corpus is ~15,211 words - fits in a single context window. You may not need a graph.

## Summary
- 360 nodes · 471 edges · 20 communities
- Extraction: 98% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 7 edges (avg confidence: 0.86)
- Token cost: 0 input · 0 output

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

## God Nodes (most connected - your core abstractions)
1. `compilerOptions` - 15 edges
2. `handle()` - 7 edges
3. `McpServer` - 7 edges
4. `createFullBackup()` - 6 edges
5. `loadConfig()` - 6 edges
6. `Scheduler` - 6 edges
7. `getSoul()` - 6 edges
8. `runOpenCode()` - 6 edges
9. `Embedder` - 6 edges
10. `scripts` - 5 edges

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

## Communities (20 total, 0 thin omitted)

### Community 0 - "Assistente OS Core"
Cohesion: 0.09
Nodes (36): AssistenteOsConfig, loadConfig(), loadDotEnv(), resolveHome(), CostCall, CostCallInput, nowIso(), recentCalls() (+28 more)

### Community 1 - "Memory Package"
Cohesion: 0.09
Nodes (25): cosine(), Embedder, LiteralEmbedder, OllamaEmbedder, addObservation(), Entity, graphStats(), listEntities() (+17 more)

### Community 2 - "Documentation"
Cohesion: 0.08
Nodes (29): kernel.db, Local-First Routing Chain, memory.db, Multi-Zen Provider Configuration, Daemon, Kernel, Memory, MCP, and CLI Layers, Stitch MCP Wrapper, Assistente OS Architecture, Assistente OS Backlog (+21 more)

### Community 3 - "Daemon Package"
Cohesion: 0.12
Nodes (17): RFC-6455, config, daemon, port, OpenCodeRunOptions, OpenCodeRunResult, resolveOpenCodeBin(), runOpenCode() (+9 more)

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
Cohesion: 0.14
Nodes (13): engines, node, name, private, scripts, build, os, test (+5 more)

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
Cohesion: 0.43
Nodes (5): BackupResult, createFullBackup(), isPreviousBackup(), stageEntry(), main()

### Community 18 - "Core TypeScript Config"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 19 - "Stitch MCP Scripts"
Cohesion: 0.50
Nodes (3): envFiles, proxy, transport

## Ambiguous Edges - Review These
- `Integrated Local-First Chat Router` → `Router Integration Backlog Item`  [AMBIGUOUS]
  docs/BACKLOG.md · relation: conceptually_related_to

## Knowledge Gaps
- **155 isolated node(s):** `name`, `version`, `private`, `type`, `node` (+150 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Integrated Local-First Chat Router` and `Router Integration Backlog Item`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `openKernelDb()` connect `Kernel & Scheduler` to `Assistente OS Core`?**
  _High betweenness centrality (0.003) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _155 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Assistente OS Core` be split into smaller, more focused modules?**
  _Cohesion score 0.09494949494949495 - nodes in this community are weakly interconnected._
- **Should `Memory Package` be split into smaller, more focused modules?**
  _Cohesion score 0.08780487804878048 - nodes in this community are weakly interconnected._
- **Should `Documentation` be split into smaller, more focused modules?**
  _Cohesion score 0.07881773399014778 - nodes in this community are weakly interconnected._
- **Should `Daemon Package` be split into smaller, more focused modules?**
  _Cohesion score 0.1225071225071225 - nodes in this community are weakly interconnected._