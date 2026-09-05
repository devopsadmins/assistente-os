/**
 * Gate de compliance ("Governança como Código") — lógica pura.
 *
 * `evaluateCompliance` recebe o corpo do PR e a lista de arquivos alterados e
 * devolve um array de pendências (strings em PT-BR). Vazio = passou.
 *
 * Sem I/O aqui de propósito: o wrapper `compliance-gate.mjs` lê o evento do
 * GitHub e o diff do git e chama esta função; os testes
 * (`compliance-rules.test.mjs`) exercitam só a lógica.
 *
 * Etapa 2 do refino (2026-08-28): removida a regra de label
 * `governanca-revisada` — num fluxo enxuto a evidência é a linha no CHANGELOG.
 * Caminho sensível agora exige o MESMO paper trail que a config de governança.
 */

/**
 * Caminhos cuja alteração exige registro (CHANGELOG.md ou docs/adr/) no mesmo
 * diff — config que afeta comportamento + superfície de governança/CI.
 */
export const PAPER_TRAIL_REQUIRED_PATHS = [
  /^packages\/core\/src\/config\.ts$/,
  /^packages\/core\/src\/policy\.ts$/,
  /^packages\/core\/src\/migrations\.ts$/,
  /^packages\/core\/src\/manifest\.ts$/,
  /^packages\/core\/src\/prompts\//,
  /^packages\/core\/src\/governance\//,
  /^\.github\//,
  /^docs\/adr\//,
];

/** Onde um registro de mudança conta como "paper trail". */
export const PAPER_TRAIL_PATHS = [/^docs\/adr\//, /^CHANGELOG\.md$/];

const MIN_BODY_CHARS = 50;
const MIN_PLAN_CHARS = 15;
const TRACKING_RE = /(ADR-[A-Z]+-\d+|ADR-\d+|roadmap|#\d+|\bE\d+(?:\.\d+)?\b|\bT\d\.\d\b)/i;
const ROLLBACK_RE = /^[ \t>*_-]*rollback\s*:\s*(.+?)\s*$/im;
const EMPTY_ROLLBACK_RE = /^_*(n\/?a|nao|não|nenhum|tbd|todo|-+)_*\.?$/i;
// SPEC-EP1: seção "Plano" — do marcador "Plano:" até o próximo heading `##`
// (ou fim do corpo), diferente de Rollback (que é 1 linha só) porque um plano
// de arquivos+ordem naturalmente ocupa mais de uma linha.
const PLAN_RE = /^[ \t>*_-]*plano\s*:\s*([\s\S]*?)(?=^##\s|\s*$)/im;
const EMPTY_PLAN_RE = /^_*(n\/?a|nao|não|nenhum|tbd|todo|vou mexer no código|-+)_*\.?$/i;

/**
 * @param {{ body?: string, changedFiles?: string[] }} input
 * @returns {string[]} pendências; vazio = aprovado
 */
export function evaluateCompliance(input = {}) {
  const body = String(input.body ?? "");
  const changedFiles = (input.changedFiles ?? []).map((f) => String(f).trim()).filter(Boolean);
  const violations = [];

  const stripped = body.replace(/<!--[\s\S]*?-->/g, "").replace(/\s+/g, " ").trim();
  if (stripped.length < MIN_BODY_CHARS) {
    violations.push(
      `Descrição do PR muito curta (${stripped.length} chars fora de comentários; mínimo ${MIN_BODY_CHARS}).`,
    );
  }

  const plan = body.match(PLAN_RE);
  const planText = plan ? plan[1].replace(/<!--[\s\S]*?-->/g, "").replace(/\s+/g, " ").trim() : "";
  if (!plan || planText.length < MIN_PLAN_CHARS || EMPTY_PLAN_RE.test(planText)) {
    violations.push(
      'Falta a seção "Plano" (arquivos + ordem de modificação) com conteúdo real — raciocínio arquitetural antes do código, nomeando arquivo(s). "N/A" não é aceito.',
    );
  }

  const rollback = body.match(ROLLBACK_RE);
  const rollbackText = rollback ? rollback[1].trim() : "";
  if (!rollback || rollbackText.length < 3 || EMPTY_ROLLBACK_RE.test(rollbackText)) {
    violations.push('Falta uma linha "Rollback:" com plano real (como reverter esta mudança). "N/A" não é aceito.');
  }

  if (!TRACKING_RE.test(body)) {
    violations.push("Falta referência de rastreabilidade (ADR-XXX, roadmap, E8.2, T1.1 ou #issue).");
  }

  const touched = changedFiles.filter((f) => PAPER_TRAIL_REQUIRED_PATHS.some((re) => re.test(f)));
  const hasPaperTrail = changedFiles.some((f) => PAPER_TRAIL_PATHS.some((re) => re.test(f)));
  if (touched.length > 0 && !hasPaperTrail) {
    violations.push(
      `Mudança em caminho sensível sem registro: ${touched.join(", ")}. ` +
        "Adicione uma entrada em CHANGELOG.md ou docs/adr/ no mesmo PR.",
    );
  }

  return violations;
}
