---
name: v4-standards
description: Aplique os Padrões Agnósticos de Engenharia e Produto v4.0 (arquitetura, segurança, privacidade, IA) em decisões arquiteturais do assistente-os, ADRs, avaliação de conformidade e classificação de perfil (Core/AI-1..AI-4).
compatibility: opencode
---

# Skill v4-standards (assistente-os)

Ponteiro local para a skill completa importada do `projeto0`. A norma, os módulos, templates e o script de diagnóstico vivem em:

- `~/.config/opencode/skills/v4-standards/SKILL.md` — instruções completas de uso, precedência, fluxo de adoção e instrumentos.
- `~/.config/opencode/skills/v4-standards/norma/` — texto normativo v4.0 e v3.0 (módulos core, IA, perfis, templates).
- `~/.config/opencode/skills/v4-standards/scripts/analyze_specs.py` — diagnóstico spec vs harness.

> O `assistente-os` ainda não passou pelo fluxo de adoção formal da norma (sem `docs/adr/` nem questionário respondido). Use esta skill quando o usuário pedir para avaliar conformidade, classificar o perfil do projeto, criar um ADR seguindo o padrão v4.0, ou decidir sobre gates de segurança/privacidade/IA — mas trate qualquer declaração de conformidade como pendente até haver evidência local real (testes, config, ADR) no próprio `assistente-os`.
