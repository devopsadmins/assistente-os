"use strict";

/**
 * Modo amigável (Fase 1) — busca/pergunta multi-tenant self-service.
 * Página separada de index.html/app.js de propósito: usuário sem token
 * admin, autenticado por conta (ver packages/daemon/src/routes/auth.ts),
 * só enxerga as próprias souls. Sem build/bundler, igual ao resto de web/.
 */

const $ = (sel) => document.querySelector(sel);
const TOKEN_KEY = "aos_friendly_token"; // separado do token do modo especialista (aos_daemon_token)

const state = {
  token: null,
  account: null,
  souls: [],
  activeSoulId: null,
};

function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; }
}
function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* localStorage indisponível */ }
}

function esc(s) {
  const div = document.createElement("div");
  div.textContent = String(s ?? "");
  return div.innerHTML;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...(state.token ? { authorization: `Bearer ${state.token}` } : {}), ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/* ---------- autenticação ---------- */

function showAuthError(msg) {
  const el = $("#friendly-auth-error");
  el.textContent = msg;
  el.hidden = !msg;
}

$("#friendly-tab-login").addEventListener("click", () => {
  $("#friendly-tab-login").classList.add("active");
  $("#friendly-tab-signup").classList.remove("active");
  $("#friendly-login-form").hidden = false;
  $("#friendly-signup-form").hidden = true;
  showAuthError("");
});
$("#friendly-tab-signup").addEventListener("click", () => {
  $("#friendly-tab-signup").classList.add("active");
  $("#friendly-tab-login").classList.remove("active");
  $("#friendly-signup-form").hidden = false;
  $("#friendly-login-form").hidden = true;
  showAuthError("");
});

$("#friendly-login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  showAuthError("");
  const email = $("#friendly-login-email").value.trim();
  const password = $("#friendly-login-password").value;
  try {
    const body = await api("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
    onAuthenticated(body);
  } catch (err) {
    showAuthError(err.status === 401 ? "e-mail ou senha incorretos" : "não deu pra entrar agora — tenta de novo");
  }
});

$("#friendly-signup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  showAuthError("");
  const email = $("#friendly-signup-email").value.trim();
  const password = $("#friendly-signup-password").value;
  try {
    const body = await api("/auth/signup", { method: "POST", body: JSON.stringify({ email, password }) });
    onAuthenticated(body);
  } catch (err) {
    showAuthError(err.message || "não deu pra criar a conta agora — tenta de novo");
  }
});

$("#friendly-logout-btn").addEventListener("click", async () => {
  try { await api("/auth/logout", { method: "POST" }); } catch { /* melhor esforço */ }
  setToken(null);
  location.reload();
});

function onAuthenticated(body) {
  state.token = body.token;
  state.account = body.account;
  setToken(body.token);
  enterApp();
}

function enterApp() {
  $("#friendly-auth").hidden = true;
  $("#friendly-app").hidden = false;
  $("#friendly-account-bar").hidden = false;
  $("#friendly-account-email").textContent = state.account?.email || "";
  loadSouls();
}

/* ---------- souls / busca ---------- */

async function loadSouls() {
  try {
    state.souls = await api("/souls");
  } catch {
    state.souls = [];
  }
  renderSouls();
}

function renderSouls() {
  const box = $("#friendly-souls");
  const empty = $("#friendly-empty");
  const askForm = $("#friendly-ask-form");
  const createBtn = $("#friendly-create-btn");
  const settingsBtn = $("#friendly-settings-btn");
  if (!state.souls.length) {
    box.innerHTML = "";
    empty.hidden = false;
    askForm.hidden = true;
    createBtn.hidden = true;
    settingsBtn.hidden = true;
    return;
  }
  empty.hidden = true;
  askForm.hidden = false;
  createBtn.hidden = false;
  settingsBtn.hidden = false;
  if (!state.activeSoulId) state.activeSoulId = state.souls[0].id;
  box.innerHTML = state.souls
    .map((s) => {
      const active = s.id === state.activeSoulId ? " active" : "";
      // config.name é sempre o slug/id (invariante forçada no core) — nunca é
      // um nome amigável de exibição. displayName é o campo editável nas
      // configurações; description é o fallback natural antes de renomear.
      const name = s.config?.displayName || s.config?.description || s.id;
      const desc = s.id;
      return `<button type="button" class="friendly-soul-chip${active}" data-soul="${esc(s.id)}">
        <span class="friendly-soul-name">${esc(name)}</span>
        <span class="friendly-soul-desc">${esc(desc)}</span>
      </button>`;
    })
    .join("");
  box.querySelectorAll(".friendly-soul-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.activeSoulId = btn.dataset.soul;
      renderSouls();
    });
  });
}

$("#friendly-ask-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("#friendly-ask-input");
  const prompt = input.value.trim();
  if (!prompt || !state.activeSoulId) return;
  const answerBox = $("#friendly-answer");
  answerBox.innerHTML = `<div class="friendly-question">${esc(prompt)}</div><div class="friendly-thinking">pensando…</div>`;
  input.value = "";
  input.disabled = true;
  try {
    const body = await api(`/souls/${encodeURIComponent(state.activeSoulId)}/chat`, {
      method: "POST",
      body: JSON.stringify({ prompt, mode: "fast" }),
    });
    if (body.ok) {
      answerBox.innerHTML = `
        <div class="friendly-question">${esc(prompt)}</div>
        <div class="friendly-answer-text">${esc(body.stdout || "não consegui responder")}</div>
        ${window.renderCitationsHtml(body.ragVerdict)}
      `;
    } else {
      answerBox.innerHTML = `<div class="friendly-question">${esc(prompt)}</div><div class="friendly-answer-text friendly-answer-err">não consegui responder agora — tenta de novo em instantes.</div>`;
    }
  } catch {
    answerBox.innerHTML = `<div class="friendly-question">${esc(prompt)}</div><div class="friendly-answer-text friendly-answer-err">algo deu errado — tenta de novo em instantes.</div>`;
  } finally {
    input.disabled = false;
    input.focus();
  }
});

/* ---------- picker de capabilities/skills liberadas pelo admin ---------- */

let availableCapabilitiesCache = null;
async function fetchAvailableCapabilities() {
  if (availableCapabilitiesCache) return availableCapabilitiesCache;
  try {
    availableCapabilitiesCache = await api("/accounts/me/available-capabilities");
  } catch {
    availableCapabilitiesCache = { capabilities: [], skills: [] };
  }
  return availableCapabilitiesCache;
}
function renderCapabilitiesPicker(container, available, checkedPatterns) {
  const checked = new Set(checkedPatterns || []);
  const capsHtml = available.capabilities
    .map((c) => `<label><input type="checkbox" data-kind="capability" value="${esc(c.pattern)}" ${checked.has(c.pattern) ? "checked" : ""} /><span class="mono">${esc(c.pattern)}</span>${c.description ? ` — <span class="muted">${esc(c.description)}</span>` : ""}</label>`)
    .join("");
  const skillsHtml = available.skills
    .map((s) => `<label><input type="checkbox" data-kind="skill" value="${esc(s.name)}" ${checked.has(s.name) ? "checked" : ""} /><span class="mono">skill: ${esc(s.name)}</span></label>`)
    .join("");
  container.innerHTML = capsHtml + skillsHtml;
}
function collectCapabilitiesPicker(container, kind) {
  return [...container.querySelectorAll(`input[data-kind="${kind}"]:checked`)].map((el) => el.value);
}

/* ---------- criação de soul (wizard, Fase 2) ---------- */

async function openCreateModal() {
  $("#friendly-create-purpose").value = "";
  $("#friendly-create-id").value = "";
  showCreateError("");
  const available = await fetchAvailableCapabilities();
  const wrap = $("#friendly-create-capabilities-wrap");
  if (available.capabilities.length || available.skills.length) {
    renderCapabilitiesPicker($("#friendly-create-capabilities"), available, []);
    wrap.hidden = false;
  } else {
    wrap.hidden = true;
  }
  $("#friendly-create-overlay").hidden = false;
  $("#friendly-create-purpose").focus();
}
function closeCreateModal() {
  $("#friendly-create-overlay").hidden = true;
}
function showCreateError(msg) {
  const el = $("#friendly-create-error");
  el.textContent = msg;
  el.hidden = !msg;
}

$("#friendly-create-btn-empty").addEventListener("click", openCreateModal);
$("#friendly-create-btn").addEventListener("click", openCreateModal);
$("#friendly-create-cancel").addEventListener("click", closeCreateModal);
$("#friendly-create-overlay").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) closeCreateModal(); // clique fora do card fecha
});

$("#friendly-create-confirm").addEventListener("click", async () => {
  const purpose = $("#friendly-create-purpose").value.trim();
  const id = $("#friendly-create-id").value.trim();
  if (!purpose) {
    showCreateError("descreve no que ele vai ajudar antes de continuar");
    return;
  }
  showCreateError("");
  const btn = $("#friendly-create-confirm");
  btn.disabled = true;
  try {
    const capPicker = $("#friendly-create-capabilities");
    const capabilities = collectCapabilitiesPicker(capPicker, "capability");
    const skills = collectCapabilitiesPicker(capPicker, "skill");
    // dry_run (valida + gera plan_hash) seguido de commit imediato — o usuário
    // amigável não precisa ver a etapa de confirmação técnica, ela é uma
    // garantia de contrato da API, não uma decisão que ele precisa tomar.
    const dry = await api("/accounts/me/souls", { method: "POST", body: JSON.stringify({ purpose, id: id || undefined, capabilities, skills }) });
    if (!dry.ok) {
      showCreateError((dry.issues && dry.issues[0] && dry.issues[0].message) || "não foi possível criar esse assistente");
      return;
    }
    const commit = await api("/accounts/me/souls", {
      method: "POST",
      body: JSON.stringify({ purpose, id: id || undefined, capabilities, skills, dry_run: false, plan_hash: dry.plan_hash }),
    });
    state.activeSoulId = commit.soul_id;
    closeCreateModal();
    await loadSouls();
  } catch (err) {
    showCreateError(err.message || "não foi possível criar esse assistente agora — tenta de novo");
  } finally {
    btn.disabled = false;
  }
});

/* ---------- configurações escopadas (Fase 3) ---------- */

function showSettingsError(msg) {
  const el = $("#friendly-settings-error");
  el.textContent = msg;
  el.hidden = !msg;
}
function closeSettingsModal() {
  $("#friendly-settings-overlay").hidden = true;
}
function renderKnowledgeUsage(knowledge) {
  $("#friendly-settings-knowledge-usage").textContent = `${knowledge.usedKb} KB de ${knowledge.limitKb} KB usados`;
}
async function refreshSettingsView() {
  const s = await api(`/accounts/me/souls/${encodeURIComponent(state.activeSoulId)}`);
  $("#friendly-settings-display-name").value = s.displayName || "";
  $("#friendly-settings-description").value = s.description || "";
  $("#friendly-settings-perfil").value = s.perfilMd || "";
  $("#friendly-settings-contexto").value = s.contextoMd || "";
  $("#friendly-settings-max-turns").value = s.guardrails.maxTurns;
  $("#friendly-settings-max-iter").value = s.guardrails.maxIterations;
  $("#friendly-settings-rag-threshold").value = s.guardrails.ragRelevanceThreshold;
  renderKnowledgeUsage(s.knowledge);

  const available = await fetchAvailableCapabilities();
  const wrap = $("#friendly-settings-capabilities-wrap");
  if (available.capabilities.length || available.skills.length) {
    renderCapabilitiesPicker($("#friendly-settings-capabilities"), available, [...s.capabilities, ...s.skills]);
    wrap.hidden = false;
  } else {
    wrap.hidden = true;
  }
}

$("#friendly-settings-btn").addEventListener("click", async () => {
  if (!state.activeSoulId) return;
  showSettingsError("");
  $("#friendly-settings-upload-result").innerHTML = "";
  $("#friendly-settings-upload-input").value = "";
  try {
    await refreshSettingsView();
    $("#friendly-settings-overlay").hidden = false;
  } catch {
    showSettingsError("não deu pra carregar as configurações agora — tenta de novo");
  }
});
$("#friendly-settings-cancel").addEventListener("click", closeSettingsModal);
$("#friendly-settings-overlay").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) closeSettingsModal();
});

$("#friendly-settings-save").addEventListener("click", async () => {
  const btn = $("#friendly-settings-save");
  btn.disabled = true;
  showSettingsError("");
  try {
    const numOrUndef = (el) => (el.value === "" ? undefined : Number(el.value));
    const capabilitiesShown = !$("#friendly-settings-capabilities-wrap").hidden;
    const capPicker = $("#friendly-settings-capabilities");
    await api(`/accounts/me/souls/${encodeURIComponent(state.activeSoulId)}`, {
      method: "PATCH",
      body: JSON.stringify({
        displayName: $("#friendly-settings-display-name").value,
        description: $("#friendly-settings-description").value,
        perfilMd: $("#friendly-settings-perfil").value,
        contextoMd: $("#friendly-settings-contexto").value,
        guardrails: {
          maxTurns: numOrUndef($("#friendly-settings-max-turns")),
          maxIterations: numOrUndef($("#friendly-settings-max-iter")),
          ragRelevanceThreshold: numOrUndef($("#friendly-settings-rag-threshold")),
        },
        // só manda capabilities/skills se o picker estava visível — ausente
        // no body = PATCH mantém o que já tinha (ver accountSouls.ts).
        ...(capabilitiesShown ? { capabilities: collectCapabilitiesPicker(capPicker, "capability"), skills: collectCapabilitiesPicker(capPicker, "skill") } : {}),
      }),
    });
    closeSettingsModal();
    await loadSouls(); // descrição pode ter mudado — atualiza o chip
  } catch (err) {
    showSettingsError(err.message || "não foi possível salvar agora — tenta de novo");
  } finally {
    btn.disabled = false;
  }
});

$("#friendly-settings-upload-btn").addEventListener("click", async () => {
  const input = $("#friendly-settings-upload-input");
  const result = $("#friendly-settings-upload-result");
  const files = input.files;
  if (!files || files.length === 0) {
    result.innerHTML = `<span class="friendly-upload-err">escolhe ao menos um arquivo</span>`;
    return;
  }
  const form = new FormData();
  for (const f of files) form.append("files", f);
  result.textContent = `enviando ${files.length} arquivo(s)…`;
  const btn = $("#friendly-settings-upload-btn");
  btn.disabled = true;
  try {
    // fetch direto, não api(): FormData define o boundary do multipart
    // sozinho — api() força content-type: application/json.
    const res = await fetch(`/souls/${encodeURIComponent(state.activeSoulId)}/upload`, {
      method: "POST",
      headers: state.token ? { authorization: `Bearer ${state.token}` } : {},
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    const savedCount = (data.saved ?? []).length;
    const rejected = data.rejected ?? [];
    const rejectedHtml = rejected.map((r) => `<div class="friendly-upload-err">✗ ${esc(r.name)}: ${esc(r.reason)}</div>`).join("");
    result.innerHTML = `${savedCount ? `<div>✓ ${savedCount} arquivo(s) enviado(s)${data.indexing ? " — indexando…" : ""}</div>` : ""}${rejectedHtml}`;
    input.value = "";
    await refreshSettingsView(); // atualiza "X de Y KB usados"
  } catch (err) {
    result.innerHTML = `<span class="friendly-upload-err">${esc(err.message || "não foi possível enviar agora")}</span>`;
  } finally {
    btn.disabled = false;
  }
});

/* ---------- boot ---------- */

(async function boot() {
  const token = getToken();
  if (!token) return; // fica na tela de auth
  state.token = token;
  try {
    const me = await api("/auth/me");
    state.account = me.account;
    enterApp();
  } catch {
    setToken(null); // sessão expirada/inválida — volta pra tela de auth
  }
})();
