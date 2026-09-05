<!--
  As quatro seções abaixo são validadas pelo job `compliance` do CI:
  descrição mínima (~50 caracteres fora de comentários), plano prévio,
  referência de rastreabilidade e plano de rollback. Mudança em caminho
  sensível (packages/core/src/{config,policy,migrations,manifest}.ts,
  packages/core/src/{prompts,governance}/, .github/, docs/adr/) exige também
  uma entrada em CHANGELOG.md ou docs/adr/ no mesmo PR.
-->

## Descrição

<!-- O que muda e por quê. -->

## Plano (arquivos + ordem)

<!-- SPEC-EP1: raciocínio arquitetural antes do código — quais arquivos mudam,
     em que ordem, e por quê nessa ordem (ex: schema antes do handler que o
     consome; teste antes da implementação). "Vou mexer no código" não é
     aceito — precisa nomear arquivo(s) reais. -->
Plano:

## Rastreabilidade

<!-- Ligue a um item de tracking: ADR-XXX, roadmap Exx, Tn.n do ARCHITECTURE-REVIEW ou #issue. -->
Ref:

## Rollback

<!-- Como reverter se der errado: revert do merge? feature flag? migração reversível? "N/A" não é aceito. -->
Rollback:
