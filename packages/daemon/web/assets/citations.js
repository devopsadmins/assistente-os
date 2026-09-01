"use strict";

/**
 * Renderização amigável de `ragVerdict` (resposta de POST /souls/:id/chat) —
 * compartilhada entre o modo especialista (app.js) e o modo amigável
 * (friendly.js). Corrige um gap: o `ragVerdict` já vinha na resposta do
 * /chat, mas nenhuma das duas UIs mostrava as fontes/confiança antes disso.
 *
 * Regra amigável: nunca mostra o score numérico cru nem o `motivo` técnico —
 * "não tenho certeza" cobre tanto `ok:false` quanto a ausência de verdict.
 */

// Espelha REFUSAL_RE de packages/daemon/src/orchestrator/escalation.ts —
// mesma heurística usada lá pra decidir escalonamento. Precisa aqui porque
// ragVerdict.ok pode vir `true` (um chunk passou o piso de confiança) e ainda
// assim o modelo, seguindo a instrução de constrained generation do próprio
// system prompt (context.ts), responder "não há evidência suficiente" — sem
// isso a UI mostrava "fontes: X" ao lado de uma resposta dizendo que não
// achou nada, o que lê como contraditório. Se um dos dois lados mudar,
// atualizar o outro junto.
const REFUSAL_RE =
  /\b(n[ãa]o sei|n[ãa]o tenho (essa )?informa|n[ãa]o (consigo|posso) (responder|ajudar)|n[ãa]o encontrei|sem informa[çc][ãa]o suficiente|n[ãa]o h[áa] evid[êe]ncia suficiente|evid[êe]ncia insuficiente|desculpe,? (mas )?n[ãa]o|i (don'?t|do not) know|i (can'?t|cannot) help)\b/i;

/**
 * @param {unknown} ragVerdict
 * @param {string} [answerText] resposta do modelo (body.stdout) — usada só
 *   pra checar se soa como recusa, mesmo com ragVerdict.ok:true.
 */
function renderCitationsHtml(ragVerdict, answerText) {
  if (!ragVerdict || typeof ragVerdict !== "object") return "";
  const v = /** @type {{ok?: boolean, sources?: Array<{doc?: string}>}} */ (ragVerdict);
  if (v.ok === false) {
    return '<div class="citations citations-unsure">🤔 não tenho certeza sobre isso — pode ser que eu não tenha essa informação.</div>';
  }
  if (typeof answerText === "string" && REFUSAL_RE.test(answerText.trim())) {
    return '<div class="citations citations-unsure">🤔 não tenho certeza sobre isso — pode ser que eu não tenha essa informação.</div>';
  }
  const sources = Array.isArray(v.sources) ? v.sources : [];
  if (!sources.length) return "";
  const docs = [...new Set(sources.map((s) => (s && typeof s.doc === "string" ? s.doc.split("::")[0] : null)).filter(Boolean))];
  if (!docs.length) return "";
  const items = docs.map((d) => `<span class="citation-chip">📄 ${escapeHtml(String(d))}</span>`).join(" ");
  return `<div class="citations citations-ok"><span class="citations-label">fontes:</span> ${items}</div>`;
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

// Exposto como global simples (mesmo padrão do resto da web/ — sem bundler/ESM aqui).
window.renderCitationsHtml = renderCitationsHtml;
