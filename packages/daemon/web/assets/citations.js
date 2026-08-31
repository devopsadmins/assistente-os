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

/** @param {unknown} ragVerdict */
function renderCitationsHtml(ragVerdict) {
  if (!ragVerdict || typeof ragVerdict !== "object") return "";
  const v = /** @type {{ok?: boolean, sources?: Array<{doc?: string}>}} */ (ragVerdict);
  if (v.ok === false) {
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
