---
name: spec-manager
description: Gerencie e analise especificações técnicas, ADRs, conformidade e drift entre spec e harness usando os Padrões de Engenharia.
compatibility: opencode
---

# Gerenciador de Especificações e Contexto

Use esta skill em mudanças significativas de requisitos ou arquitetura, na criação ou revisão de ADRs, e para avaliar conformidade e riscos de implementação.

## Fonte de referência

Trabalhe com os recursos locais deste projeto:

- **ADRs:** `docs/adr/` — registre novas decisões seguindo o template em `~/.config/opencode/skills/spec-manager/templates/ADR_TEMPLATE.md`.
- **Templates e diretrizes:** `~/.config/opencode/skills/spec-manager/references/context_guidelines.md`.
- **Diagnóstico:** `~/.config/opencode/skills/spec-manager/scripts/analyze_specs.py` (varredura de ADRs, cobertura de testes e saúde de specs).

> O MCP `standards` (que consultava o repositório canônico `D:/Projetos/projeto0`) não está disponível neste ambiente Linux. As consultas devem usar os recursos locais acima.

## Diretrizes operacionais

1. Consulte as ADRs existentes e o template antes de recomendar mudanças arquiteturais relevantes.
2. Explicite conflitos de segurança, privacidade, obrigações legais, integridade de dados e contratos versionados.
3. Declare claramente quais evidências locais foram inspecionadas (ADRs, testes, código-fonte) ao avaliar o `assistente-os`.
