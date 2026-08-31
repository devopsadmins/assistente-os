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
  if (!state.souls.length) {
    box.innerHTML = "";
    empty.hidden = false;
    askForm.hidden = true;
    return;
  }
  empty.hidden = true;
  askForm.hidden = false;
  if (!state.activeSoulId) state.activeSoulId = state.souls[0].id;
  box.innerHTML = state.souls
    .map((s) => {
      const active = s.id === state.activeSoulId ? " active" : "";
      const desc = s.config?.description || s.id;
      const name = s.config?.name || s.id;
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
