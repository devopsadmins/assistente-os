# SkillJuror — Mapeamento para a arquitetura de skills do Assistente OS

> **ARQUIVADO (2026-08-19):** Os 5 skills-alvo (`wordpress-ultimate`, `vercel`, `astro`, `mysql-database-skill`, `drawio`) não existem neste Linux — eram armazenados dentro dos diretórios de souls no Windows (`~/.config/opencode/souls/<soul>/conhecimento/skills/`) e nunca foram migrados. O split proposto na Seção 3 só pode ser executado se os arquivos-fonte forem recuperados da máquina Windows original. O checklist na Seção 5 está fechado como N/A.

**Fonte:** paper *"SkillJuror: A Knowledge-Inspired Evaluation Framework for Assigning Trust in Large-Scale Skill Marketplaces"* (arXiv `2606.11543v1`).
**Escopo:** aplicar as descobertas do paper à organização das `SKILL.md` das souls `consultoria_ia` e `desenvolvimento`.
**Data:** 2026-08-15.

---

## 1. Resumo das descobertas do paper

### RQ3 — Prompt Design e a carga de arquivos

| Achado | Implicação |
|---|---|
| Prompt design (PD) direcionado gera mais aberturas/revisitas de arquivos de recurso (`grep`, `ls`, `tree`) | Conteúdo de skill precisa ser *recuperável sob demanda*, não decorado |
| PD cria o padrão **implementar-verificar-reparar** (loops) | Estrutura de skill deve reduzir fricção de reentrada no contexto |
| Sem PD, a skill vira "leitura-e-execução" única (1 passo, sem revisita) | Skills simples não precisam de estrutura pesada |

### RQ4 — Arquétipos de desempenho

| Arquétipo | Comportamento | Aula |
|---|---|---|
| **Targeted efficiency gain** (código/segurança) | `0/5 → 5/5` | PD direcionado transforma a skill |
| **Uptake without success** (numérico) | `5/5 → 3/5` | PD atrapalha quando o domínio é constraint-bound (tolerância numérica) |
| **Fanout tax** (mídia/artefato) | `5/5 → 2/5` | PD piora — abre arquivos demais, perde contexto |
| **Completion-with-risk** (otimização) | `0/5 → 5/5` runtime, mas `3/5` schema estrito | Sucesso em tarefa aberta, risco em output estrito |

### Recomendação central

- **PD / modularização em camadas para domínios exploratórios** (código, conteúdo, diagramas, pipelines).
- **Manter plano (flat) para domínios constraint-bound** (tolerância numérica, schemas estritos, comandos exatos).
- A modularização que remove a cópia explícita de detalhes acerta os arquétipos **targeted efficiency gain** e **completion-with-risk**, mas erra os **uptake-without-success** e **fanout tax**.

### Regra de design adotada

1. **Raiz (`SKILL.md`) = entrada enxuta** (`< ~60 linhas`): estratégia de uso, quando usar, e links para os arquivos de recurso.
2. **Detalhe vai para `references/` ou arquivos de tópico**, cada um abrindo com uma linha explícita de "**Leia quando / por que**".
3. **Domínio constraint-bound fica flat** — sem quebrar detalhes que o agente precisa ver antes de agir (ex.: templates SQL, comandos exatos).
4. **Skills pequenas e focadas não são tocadas.**

---

## 2. Mapeamento das skills atuais

Legenda de arquétipo: **C** = código/segurança, **CB** = constraint-bound, **API** = contrato de API, **A** = artefato/conteúdo, **M** = meta/workflow.

| Skill | Soul | Linhas | Arquétipo | Veredito | Ação |
|---|---|---|---|---|---|
| `laravel` | consultoria_ia | 31 | C | Manter | — |
| `php` | consultoria_ia | 32 | C | Manter | — |
| `postgres-mcp-skill` | consultoria_ia | 27 | CB | Manter (flat) | — |
| `microsoft-graph` | consultoria_ia | 48 | API | Manter | — |
| `azure-devops` | consultoria_ia | 92 | C | Manter (perto do limite) | revisar depois |
| `wordpress-ultimate` | consultoria_ia | 175 | A | **Dividir** | raiz enxuta + `references/` |
| `vercel` | consultoria_ia | 288 | A | **Dividir** | raiz enxuta + `references/` |
| `astro` | consultoria_ia | 311 | A | **Dividir** | raiz enxuta + `references/` |
| `mysql-database-skill` | consultoria_ia | 471 | CB + C | **Dividir** | raiz enxuta; templates SQL → `references/` (flat, não quebrar) |
| `drawio` | desenvolvimento | 389 | A | **Dividir** | raiz enxuta + `references/` |
| `improve` | desenvolvimento | 85 | M | Manter | — |
| `ponytail*` | desenvolvimento | 27–83 | M/C | Manter | — |

### Critérios

- **Dividir** quando a raiz passa de ~120 linhas E o arquétipo é exploratório (A) ou misto (CB+C) → cai na classe **fanout tax** do paper.
- **Manter flat** para constraint-bound puro (`postgres-mcp-skill`) — o paper mostra que modularizar acerta prazer, mas destrói correção em domínios de esquema estrito.
- **Não tocar** em skills pequenas e focadas (≤ 120 linhas).

---

## 3. Proposta de split por skill

Cada raiz nova terá: frontmatter preservado, estratégia de uso, "quando usar", e links explícitos ("Leia quando...") para os arquivos de recurso.

### 3.1 `wordpress-ultimate` (consultoria_ia — 175 linhas)

- Já possui `references/` e `scripts/`.
- **Raiz:** frontmatter + estratégia + Setup (3 env vars) + Segurança (draft-only, nunca DELETE, creds via `.env`).
- **Mover para `references/`:** WP API details, SEO patterns (após ler o conteúdo atual).

### 3.2 `vercel` (consultoria_ia — 288 linhas)

- **Raiz:** frontmatter + "Quando usar" + estratégia de deploy.
- **Mover para `references/`:** comandos CLI detalhados (deploy, preview, env), documentação via curl.

### 3.3 `astro` (consultoria_ia — 311 linhas)

- **Raiz:** frontmatter + "Quando usar" + pré-requisitos (Node 20+, conta Cloudflare, repo git) + quick start.
- **Mover para `references/`:** deploy estático vs SSR no Cloudflare, configuração detalhada.

### 3.4 `mysql-database-skill` (consultoria_ia — 471 linhas, conteúdo em chinês)

- **Caso especial (constraint-bound):** os 5 cenários de uso (query, DESCRIBE, INSERT/UPDATE/DELETE, estatísticas, export) são templates SQL exatos.
- **Raiz:** frontmatter + cenários resumidos + comando base (`mysql -h <host> -u <user> --database <db> -s -r -e "..."`).
- **Mover para `references/`:** templates SQL completos por cenário, **sem** alterar o texto (correção > concisão — arquétipo uptake-without-success).
- Manter o conteúdo em chinês (zh-CN), apenas relocalizando.

### 3.5 `drawio` (desenvolvimento — 389 linhas)

- **Raiz:** frontmatter + "quando usar" + decisão Mermaid vs XML (tabela resumida; preferir Mermaid quando CLI desktop disponível).
- **Mover para `references/`:** autorização detalhada, exemplos de diagramas XML.

---

## 4. Skills que NÃO mudam

- `laravel`, `php`, `postgres-mcp-skill`, `microsoft-graph`, `azure-devops`, `improve`, `ponytail*`.
- `azure-devops` (92 linhas) fica abaixo do limite, mas é o próximo candidato a revisão se crescer.

---

## 5. Checklist de execução

- [x] Escrever `docs/skilljuror-mapping.md` (este documento)
- [x] Ler na íntegra os 5 `SKILL.md` (reads anteriores truncaram)
- [ ] ~~Dividir `wordpress-ultimate`~~ — N/A (skill não existe no Linux)
- [ ] ~~Dividir `vercel`~~ — N/A (skill não existe no Linux)
- [ ] ~~Dividir `astro`~~ — N/A (skill não existe no Linux)
- [ ] ~~Dividir `mysql-database-skill`~~ — N/A (skill não existe no Linux)
- [ ] ~~Dividir `drawio`~~ — N/A (skill não existe no Linux)
- [x] Não tocar: `laravel`, `php`, `postgres-mcp-skill`, `microsoft-graph`, `azure-devops`, `improve`, `ponytail*`
