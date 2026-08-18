---
name: spec-manager
description: Gerencie e analise especificações técnicas, ADRs, conformidade e drift entre spec e harness usando os Padrões de Engenharia.
compatibility: opencode
---

# Gerenciador de Especificações e Contexto

Use esta skill em mudanças significativas de requisitos ou arquitetura, na criação ou revisão de ADRs, e para avaliar conformidade e riscos de implementação.

## Fonte canônica e ferramentas

Os Padrões de Engenharia são mantidos em `D:/Projetos/projeto0`. A capacidade MCP `standards` já está configurada neste projeto e deve ser a interface preferida para consultá-los.

Use as ferramentas MCP conforme a necessidade:

- `standards_read_doc` para consultar a norma, módulos e templates.
- `standards_resolve` para versão ativa e precedência de decisões.
- `standards_classify_profile` e `standards_gate_blockg` para classificação e gates de risco.
- `standards_draft_adr` para criar ADRs rastreáveis.
- `standards_spec_drift` para verificar o repositório canônico dos padrões.
- `standards_validate_evidence`, `standards_questionnaire`, `standards_conformance` e `standards_map_artifacts` para a adoção formal.
- `standards_context_manager` para manter o contexto executivo dos padrões.

## Diretrizes operacionais

1. Consulte a norma aplicável antes de recomendar mudanças arquiteturais relevantes.
2. Explicite conflitos de segurança, privacidade, obrigações legais, integridade de dados e contratos versionados segundo a ordem de precedência da norma.
3. Não apresente o resultado de `standards_spec_drift` como uma análise do `assistente-os`: o gate atual avalia o repositório canônico em `D:/Projetos/projeto0`.
4. Para avaliar o `assistente-os`, aplique os critérios e templates obtidos pelo MCP e declare claramente quais evidências locais foram inspecionadas.
