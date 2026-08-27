/**
 * Gate de compliance ("Governança como Código") — lógica pura.
 *
 * `evaluateCompliance` recebe o corpo do PR, a lista de arquivos alterados e os
 * labels, e devolve um array de pendências (strings em PT-BR). Vazio = passou.
 *
 * Sem I/O aqui de propósito: o wrapper `compliance-gate.mjs` lê o evento do
 * GitHub e o diff do git e chama esta função; os testes
 * (`compliance-rules.test.mjs`) exercitam só a lógica.
 */

/** Caminhos sensíveis: alteração exige o label de revisão ou 2º aprovador. */
export const SENSITIVE_PATHS = [
  /^packages\/core\/src\/governance\//,
  /^packages\/core\/src\/policy\.ts$/,
  /^packages\/core\/src\/migrations\.ts$/,
  /^\.github\//,
  /^docs\/adr\//,
];

/** Config que afeta comportamento/governança: alteração exige registro (ADR/CHANGELOG). */
export const GOVERNANCE_CONFIG_PATHS = [
  /^packages\/core\/src\/config\.ts$/,
  /^packages\/core\/src\/policy\.ts$/,
  /^packages\/core\/src\/migrations\.ts$/,
  /^packages\/core\/src\/manifest\.ts$/,
  /^packages\/core\/src\/prompts\//,
  /^packages\/core\/src\/governance\//,
  /^\.github\/workflows\//,
];

/** Onde um registro de mudança conta como "paper trail". */
export const PAPER_TRAIL_PATHS = [/^docs\/adr\//, /^CHANGELOG\.md$/];

export const REVIEW_LABEL = "governanca-revisada";

const MIN_BODY_CHARS = 50;
const TRACKING_RE = /(ADR-[A-Z]+-\d+|ADR-\d+|roadmap|#\d+|\bE\d+(?:\.\d+)?\b|\bT\d\.\d\b)/i;
const ROLLBACK_RE = /^[ \t>*_-]*rollback\s*:\s*(.+?)\s*$/im;
const EMPTY_ROLLBACK_RE = /^_*(n\/?a|nao|não|nenhum|tbd|todo|-+)_*\.?$/i;

/**
 * @param {{ body?: string, changedFiles?: string[], labels?: string[] }} input
 * @returns {string[]} pendências; vazio = aprovado
 */
export function evaluateCompliance(input = {}) {
  const body = String(input.body ?? "");
  const changedFiles = (input.changedFiles ?? []).map((f) => String(f).trim()).filter(Boolean);
  const labels = (input.labels ?? []).map((l) => String(l).toLowerCase());
  const violations = [];

  const stripped = body.replace(/<!--[\s\S]*?-->/g, "").replace(/\s+/g, " ").trim();
  if (stripped.length < MIN_BODY_CHARS) {
    violations.push(
      `Descrição do PR muito curta (${stripped.length} chars fora de comentários; mínimo ${MIN_BODY_CHARS}).`,
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

  const touchedGovConfig = changedFiles.filter((f) => GOVERNANCE_CONFIG_PATHS.some((re) => re.test(f)));
  const hasPaperTrail = changedFiles.some((f) => PAPER_TRAIL_PATHS.some((re) => re.test(f)));
  if (touchedGovConfig.length > 0 && !hasPaperTrail) {
    violations.push(
      `Mudança em config sensível sem registro: ${touchedGovConfig.join(", ")}. ` +
        "Adicione entrada em docs/adr/ ou CHANGELOG.md no mesmo PR.",
    );
  }

  const touchedSensitive = changedFiles.filter((f) => SENSITIVE_PATHS.some((re) => re.test(f)));
  if (touchedSensitive.length > 0 && !labels.includes(REVIEW_LABEL)) {
    violations.push(
      `Alteração em caminho sensível (${touchedSensitive.join(", ")}) exige o label "${REVIEW_LABEL}" ` +
        "(aplicado por um mantenedor após revisão) ou um segundo aprovador.",
    );
  }

  return violations;
}
