"use strict";

/* ---------- estado ---------- */
const state = {
  souls: [],
  active: null,
  tier: null,
};

const $ = (sel) => document.querySelector(sel);

/* ---------- menu mobile ---------- */
function toggleMenu(forceClose = false) {
  const sidebar = $(".sidebar");
  const overlay = $("#sidebar-overlay");
  if (!sidebar || !overlay) return;
  if (forceClose) {
    sidebar.classList.remove("open");
    overlay.classList.remove("open");
  } else {
    sidebar.classList.toggle("open");
    overlay.classList.toggle("open");
  }
}
$("#mobile-menu-btn")?.addEventListener("click", () => toggleMenu());
$("#sidebar-overlay")?.addEventListener("click", () => toggleMenu(true));


/* ---------- api ---------- */
// Suporte a ASSISTENTE_OS_DAEMON_TOKEN: obrigatório quando o daemon escuta
// fora de localhost (ex.: acesso pela LAN). Guardado em localStorage; pedido
// uma vez no boot() se ainda não tiver um salvo.
function getToken() {
  return localStorage.getItem("aos_token") || "";
}
function setToken(t) {
  if (t) localStorage.setItem("aos_token", t);
  else localStorage.removeItem("aos_token");
}
async function ensureToken() {
  // Só pergunta se uma chamada sem token falhar com 401 — em localhost
  // (padrão sem token configurado) isso nunca dispara.
  const probe = await fetch("/health", { headers: authHeaders() });
  if (probe.status !== 401) return;
  const t = window.prompt("Token do daemon (ASSISTENTE_OS_DAEMON_TOKEN):", "") || "";
  if (t) setToken(t);
}
function authHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...authHeaders(), ...(options.headers || {}) },
  });
  if (res.status === 401) setToken(""); // token salvo não é mais válido
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/* ---------- util ---------- */
function fmtCost(n) {
  return `${Number(n).toFixed(4)}`;
}
function esc(s) {
  const div = document.createElement("div");
  div.textContent = String(s ?? "");
  return div.innerHTML;
}
function ic(name) {
  return `<svg class="ic"><use href="#i-${name}"/></svg>`;
}
function fmtTs(iso) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? String(iso) : d.toLocaleString("pt-BR");
}
function fmtBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

/* ---------- abas ---------- */
$("#tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === btn));
  document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === `tab-${btn.dataset.tab}`));
  if (btn.dataset.tab === "dashboard") loadDashboard();
  if (btn.dataset.tab === "memory" && state.active) loadMemoryStatus();
  if (btn.dataset.tab === "graph" && state.active) loadGraph();
  if (btn.dataset.tab === "langgraph" && state.active) loadLangGraph();
  if (btn.dataset.tab === "observability") loadObservability();
  if (btn.dataset.tab === "buffer") loadBuffer();
  if (btn.dataset.tab === "llm") loadLlm();
  if (btn.dataset.tab === "mcp") loadMcp();
});

/* ---------- websocket ---------- */
function connectWs() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}`);
  ws.onopen = () => {
    $("#ws-info").textContent = "ws: on";
    $("#ws-info").style.color = "#00ff9d";
  };
  ws.onclose = () => {
    $("#ws-info").textContent = "ws: off";
    $("#ws-info").style.color = "";
    setTimeout(connectWs, 3000);
  };
  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === "chat.done") {
        const row = document.querySelector(`.soul-item[data-soul="${CSS.escape(msg.soul)}"]`);
        if (row) row.querySelector(".soul-status").textContent = msg.code === 0 && !msg.timedOut ? "✓ ok" : "✗ erro";
        if ($("#tab-dashboard").classList.contains("active")) loadDashboard();
      }
      if (msg.type === "monitor.updated" || msg.type === "event.received" || msg.type === "event.processed") {
        if ($("#tab-observability").classList.contains("active")) loadObservability();
      }
      if (msg.type === "index.done") {
        const status = document.querySelector("#upload-index-status");
        if (status) status.textContent = `indexado: ${msg.indexed} chunks de ${msg.files} arquivo(s)`;
        loadMemoryStatus();
      }
      if (msg.type === "graph.step") {
        renderLangGraphStep(msg);
      }
    } catch {
      /* ignora frames inválidos */
    }
  };
}

/* ---------- sidebar: souls ---------- */
async function loadSouls() {
  const souls = await api("/souls");
  state.souls = souls;
  renderSouls();
}

function renderSouls() {
  const list = $("#soul-list");
  const filter = ($("#soul-filter").value || "").toLowerCase();
  list.innerHTML = "";
  for (const soul of state.souls) {
    if (filter && !soul.id.toLowerCase().includes(filter)) continue;
    const li = document.createElement("li");
    li.className = "soul-item" + (state.active === soul.id ? " active" : "");
    li.dataset.soul = soul.id;
    li.innerHTML = `
      <div class="soul-name">${ic("soul")} ${esc(soul.config.name || soul.id)}</div>
      <div class="soul-desc">${esc(soul.config.description || soul.id)}</div>
      <div class="soul-status" style="font-size:10px;color:#7a7a9a"></div>`;
    li.addEventListener("click", () => selectSoul(soul.id));
    list.appendChild(li);
  }
}

function selectSoul(id) {
  state.active = id;
  const soul = state.souls.find((s) => s.id === id);
  $("#chat-title").textContent = soul ? `Chat · ${soul.config.name || id}` : `Chat · ${id}`;
  renderSouls();
  if ($("#tab-memory").classList.contains("active")) loadMemoryStatus();
  if ($("#tab-graph").classList.contains("active")) loadGraph();
  toggleMenu(true);
}

$("#soul-filter").addEventListener("input", renderSouls);

/* ---------- dashboard / C&C ---------- */
async function loadDashboard() {
  const [health, router] = await Promise.all([
    api("/health").catch(() => null),
    api("/router/status").catch(() => null),
  ]);

  state.tier = router ? router.tiers[router.tiers.length - 1] : "soul";

  // Preenche top cards
  $("#cnc-almas").textContent = state.souls.length;
  const sessStats = await api("/sessions/stats").catch(() => null);
  $("#cnc-sessoes").textContent = sessStats?.total ?? "—";
  $("#cnc-ativa").textContent = state.active || "—";
  $("#cnc-motor").textContent = state.tier;

  // Renderiza a lista central de cards
  const list = $("#cnc-soul-list");
  list.innerHTML = "";
  for (const soul of state.souls) {
    const isActive = state.active === soul.id;
    list.innerHTML += `
      <div class="cnc-soul-card" onclick="selectSoul('${esc(soul.id)}')">
        <div class="head">
          <h3>${esc(soul.id)}</h3>
          <span class="status" style="border-color:${isActive ? 'var(--neon-cyan)' : 'var(--border-base)'}; color:${isActive ? 'var(--neon-cyan)' : 'var(--text-muted)'}">${isActive ? 'ativa' : 'ociosa'}</span>
        </div>
        <div class="desc">${esc(soul.config.description || "(sem descrição)")}</div>
      </div>
    `;
  }
  
  if (!window._graphRunning) {
    window._graphRunning = true;
    startNetworkGraph();
  }
}

function startNetworkGraph() {
  const cvs = document.getElementById("network-canvas");
  if (!cvs) return;
  const ctx = cvs.getContext("2d");
  let width, height;

  function resize() {
    width = cvs.clientWidth;
    height = cvs.clientHeight;
    cvs.width = width;
    cvs.height = height;
  }
  window.addEventListener("resize", resize);
  resize();

  const nodes = Array.from({ length: 30 }).map(() => ({
    x: Math.random() * width,
    y: Math.random() * height,
    vx: (Math.random() - 0.5) * 0.5,
    vy: (Math.random() - 0.5) * 0.5,
  }));

  function draw() {
    ctx.clearRect(0, 0, width, height);
    ctx.lineWidth = 1;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      n.x += n.vx;
      n.y += n.vy;
      if (n.x < 0 || n.x > width) n.vx *= -1;
      if (n.y < 0 || n.y > height) n.vy *= -1;

      for (let j = i + 1; j < nodes.length; j++) {
        const n2 = nodes[j];
        const dx = n.x - n2.x;
        const dy = n.y - n2.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 100) {
          ctx.beginPath();
          ctx.moveTo(n.x, n.y);
          ctx.lineTo(n2.x, n2.y);
          ctx.strokeStyle = `rgba(0, 240, 255, ${1 - dist / 100})`;
          ctx.stroke();
        }
      }

      ctx.beginPath();
      ctx.arc(n.x, n.y, 2, 0, Math.PI * 2);
      ctx.fillStyle = "#00f0ff";
      ctx.fill();
    }
    requestAnimationFrame(draw);
  }
  draw();
}

/* ---------- chat ---------- */
const chatLog = $("#chat-log");
let currentMode = "auto";

function addMsg(kind, html) {
  const div = document.createElement("div");
  div.className = `msg ${kind}`;
  div.innerHTML = html;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
}

async function sendChat(prompt) {
  if (!state.active) {
    addMsg("err", "Selecione uma soul na sidebar antes de enviar.");
    return;
  }
  const model = $("#chat-model").value.trim() || undefined;
  const tier = $("#chat-tier").value;
  const sendBtn = $("#chat-send");
  sendBtn.disabled = true;
  addMsg("user", esc(prompt));
  addMsg("meta", "processando…");
  try {
    const body = await api(`/souls/${encodeURIComponent(state.active)}/chat`, {
      method: "POST",
      body: JSON.stringify({ prompt, model, tier, mode: currentMode === "auto" ? undefined : currentMode }),
    });
    chatLog.removeChild(chatLog.lastChild);
    const meta = `tier: ${esc(body.tier)} · mode: ${esc(body.mode || "auto")} · model: ${esc(body.model)} · code: ${body.code}${body.timedOut ? " · timedOut" : ""} · ${esc(body.routerReason || "")}`;
    if (body.ok) {
      let soulHtml = "";
      if (body.toolCalls?.length) {
        const toolsHtml = body.toolCalls.map((tc) => `
          <div class="tool-call">
            <span class="tool-name chip">${esc(tc.name)}</span>
            <details>
              <summary>args</summary>
              <pre>${esc(JSON.stringify(tc.args, null, 2))}</pre>
            </details>
            <details>
              <summary>resultado</summary>
              <pre>${esc(tc.result)}</pre>
            </details>
          </div>`).join("");
        soulHtml += `<div class="tool-calls"><div class="tool-calls-header">Tools executadas (${body.toolCalls.length})</div>${toolsHtml}</div>`;
      }
      soulHtml += esc(body.stdout || "(sem saída)");
      addMsg("soul", `<div class="meta-row">${esc(meta)}</div>${soulHtml}`);
    } else {
      addMsg("soul", `<div class="meta-row">${esc(meta)}</div><pre class="mono" style="white-space:pre-wrap">${esc(body.stderr || body.stdout || "falha sem detalhes")}</pre>`);
    }
  } catch (err) {
    chatLog.removeChild(chatLog.lastChild);
    addMsg("err", esc(err.message));
  } finally {
    sendBtn.disabled = false;
  }
}

$("#chat-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $("#chat-input");
  const value = input.value.trim();
  if (!value) return;
  input.value = "";
  sendChat(value);
});

$("#chat-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    $("#chat-form").requestSubmit();
  }
});

/* ---------- mode toggle ---------- */
$(".mode-toggle")?.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  currentMode = btn.dataset.mode;
  $(".mode-toggle .active")?.classList.remove("active");
  btn.classList.add("active");
});

/* ---------- buffer da soul ---------- */
async function loadBuffer() {
  if (!state.active) {
    $("#buffer-box").innerHTML = `<span class="muted">Selecione uma soul na sidebar.</span>`;
    return;
  }
  $("#buffer-box").innerHTML = `<span class="muted">lendo…</span>`;
  try {
    const b = await api(`/souls/${encodeURIComponent(state.active)}/buffer`);
    const nonEmpty = (b.files || []).filter((f) => f.chars > 0);
    const buf = [];
    buf.push(`
      <div style="margin-bottom:6px">
        <span class="chip">${nonEmpty.length} arquivos</span>
        <span class="chip">${b.contextChars} chars</span>
        <span class="chip">~${b.tokenEstimate} tokens</span>
        ${b.ragVerdict && b.ragVerdict.ok ? `<span class="chip ok">rag: ${esc(b.ragVerdict.method)}</span>` : `<span class="chip">rag: —</span>`}
      </div>
      <div style="margin-bottom:8px">${
        nonEmpty
          .map(
            (f) => `<span class="chip" title="${esc(f.path)}">${esc(f.path.split(/[\\/]/).pop())}: ${f.chars}</span>`,
          )
          .join("")
      }</div>
      <details>
        <summary style="cursor:pointer">ver system prompt montado</summary>
        <pre class="mono" style="white-space:pre-wrap;font-size:11px;margin-top:6px;max-height:40vh;overflow:auto">${esc(b.systemPrompt)}</pre>
      </details>`);
    $("#buffer-box").innerHTML = buf.join("");
  } catch (err) {
    $("#buffer-box").innerHTML = `<span class="muted">erro: ${esc(err.message)}</span>`;
  }
}

$("#chat-buffer").addEventListener("click", loadBuffer);

/* ---------- memória ---------- */
async function loadMemoryStatus() {
  if (!state.active) {
    $("#memory-status").innerHTML = `<span class="muted">Selecione uma soul na sidebar.</span>`;
    return;
  }
  const st = await api(`/souls/${encodeURIComponent(state.active)}/memory/status`).catch(() => null);
  $("#memory-status").innerHTML = st
    ? `soul <b>${esc(st.soul)}</b> · <span class="chip">${st.chunks.chunks} chunks</span><span class="chip">${st.chunks.files} arquivos</span>
       <span class="chip">${st.graph.entities} entidades</span><span class="chip">${st.graph.relations} relações</span><span class="chip">${st.graph.observations} observações</span>`
    : `<span class="muted">memória indisponível</span>`;
}

$("#memory-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const query = $("#memory-query").value.trim();
  const threshold = parseFloat($("#memory-threshold").value);
  const box = $("#memory-results");
  if (!state.active) {
    box.innerHTML = `<span class="muted">Selecione uma soul na sidebar.</span>`;
    return;
  }
  if (!query) return;
  box.innerHTML = `<span class="muted">buscando…</span>`;
  try {
    const data = await api(`/souls/${encodeURIComponent(state.active)}/memory/search`, {
      method: "POST",
      body: JSON.stringify({ query, limit: 8, minScore: threshold }),
    });
    if (!data.results.length) {
      box.innerHTML = `<span class="muted">nenhum resultado para <b>${esc(query)}</b></span>`;
      return;
    }
    box.innerHTML = data.results
      .map(
        (r) => `
        <div class="result-item">
          <div class="result-head">
            <span class="chip">${esc(r.method)}</span>
            <span class="chip">score ${Number(r.score).toFixed(3)}</span>
            <span class="mono">${esc(r.doc)}</span>
          </div>
          <div class="result-body">${esc(r.snippet)}</div>
        </div>`,
      )
      .join("");
} catch (err) {
    box.innerHTML = `<span class="muted">erro: ${esc(err.message)}</span>`;
  }
});

// Atualiza o valor do threshold enquanto o slider é movimentado
$("#memory-threshold")?.addEventListener("input", () => {
  $("#threshold-value").textContent = $("#memory-threshold").value;
});

/* ---------- upload ---------- */
$("#upload-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("#upload-input");
  const result = $("#upload-result");
  if (!state.active) {
    result.innerHTML = `<span class="muted">Selecione uma soul na sidebar.</span>`;
    return;
  }
  const files = input.files;
  if (!files || files.length === 0) {
    result.innerHTML = `<span class="muted">Escolha ao menos um arquivo.</span>`;
    return;
  }
  const form = new FormData();
  for (const f of files) form.append("files", f);
  result.innerHTML = `<span class="muted">enviando ${files.length} arquivo(s)…</span>`;
  try {
    // fetch direto (não api()): FormData precisa definir o boundary do
    // multipart sozinho, api() força content-type: application/json.
    const res = await fetch(`/souls/${encodeURIComponent(state.active)}/upload`, {
      method: "POST",
      headers: authHeaders(),
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    const savedList = (data.saved ?? [])
      .map((s) => `<div>✓ ${esc(s.name)}${s.extracted ? ` (${s.extracted.length} arquivo(s) extraído(s) do zip)` : ""}</div>`)
      .join("");
    const rejectedList = (data.rejected ?? [])
      .map((r) => `<div style="color:var(--neon-red,#ff2a2a)">✗ ${esc(r.name)}: ${esc(r.reason)}</div>`)
      .join("");
    const indexingNote = (data.indexing ?? 0) > 0
      ? `indexando ${data.indexing} arquivo(s) em segundo plano…`
      : `nenhum arquivo de texto para indexar`;
    result.innerHTML = `${savedList}${rejectedList}<div class="muted" style="margin-top:6px" id="upload-index-status">${indexingNote}</div>`;
    input.value = "";
    loadMemoryStatus();
  } catch (err) {
    result.innerHTML = `<span class="muted">erro: ${esc(err.message)}</span>`;
  }
});

/* ---------- grafo ---------- */
async function loadGraph() {
  if (!state.active) {
    ["#graph-entities", "#graph-relations", "#graph-observations"].forEach((sel) => ($(sel).innerHTML = `<li class="muted">selecione uma soul</li>`));
    return;
  }
  const g = await api(`/souls/${encodeURIComponent(state.active)}/graph`).catch(() => null);
  if (!g) {
    ["#graph-entities", "#graph-relations", "#graph-observations"].forEach((sel) => ($(sel).innerHTML = `<li class="muted">grafo indisponível</li>`));
    return;
  }
  $("#graph-entities").innerHTML = g.entities.length
    ? g.entities.map((en) => `<li><span class="chip">${esc(en.kind)}</span> ${esc(en.name)}</li>`).join("")
    : `<li class="muted">sem entidades</li>`;
  $("#graph-relations").innerHTML = g.relations.length
    ? g.relations.map((r) => `<li>${esc(r.from)} <span class="rel">→ ${esc(r.rel)} →</span> ${esc(r.to)}</li>`).join("")
    : `<li class="muted">sem relações</li>`;
  $("#graph-observations").innerHTML = g.observations.length
    ? g.observations
        .map(
          (o) => `
          <li class="obs">
            <b>${esc(o.entity)}</b> · ${fmtTs(o.ts)}${o.source ? ` · ${esc(o.source)}` : ""}<br/>
            ${esc(o.body)}
          </li>`,
        )
        .join("")
    : `<li class="muted">sem observações</li>`;
}

}

/* ---------- langgraph ---------- */
async function loadLangGraph() {
  if (!state.active) {
    ["#langgraph-svg", "#lg-steps", "#lg-tools"].forEach((sel) => ($(sel).innerHTML = ""));
    $("#langgraph-status").textContent = "Selecione uma soul";
    return;
  }
  const g = await api(`/souls/${encodeURIComponent(state.active)}/langgraph/status`).catch(() => null);
  if (!g) {
    $("#langgraph-status").textContent = "Status indisponível";
    return;
  }
  $("#langgraph-status").textContent = g.ollamaAvailable ? "Ollama disponível" : "Ollama indisponível";
  $("#langgraph-mode").value = "full";
}

function renderLangGraphStep(msg) {
  const node = msg.node || "unknown";
  const stepEl = $("#lg-steps");
  const steps = stepEl.querySelectorAll(".lg-step-entry");
  
  // Atualizar a etapa atual
  steps.forEach((s, i) => {
    s.classList.remove("active", "done", "error");
    if (i === msg.iterationCount - 1) {
      s.classList.add("active");
      s.classList.add(msg.ok ? "done" : "error");
    }
  });
  
  // Adicionar entrada de passo se não existir
  const lastStep = steps[steps.length - 1];
  const lastNode = lastStep?.className || "";
  const isActive = lastNode.includes("active");
  
  if (!isActive) {
    const newStep = document.createElement("div");
    newStep.className = "lg-step-entry";
    newStep.innerHTML = `
      <span class="lg-step-node">${node}</span>
      <span class="lg-step-time">${new Date().toLocaleTimeString()}</span>
    `;
    stepEl.insertBefore(newStep, lastStep || null);
    // Manter apenas últimas 10 etapas
    while (stepEl.children.length > 10) {
      stepEl.removeChild(stepEl.firstChild);
    }
  }
  
  // Atualizar ferramentas executadas
  const toolsEl = $("#lg-tools");
  if (msg.toolCalls && msg.toolCalls.length) {
    toolsEl.innerHTML = msg.toolCalls.slice(0, 5).map((tc) => `
      <div class="lg-tool-item">
        <span class="lg-tool-name">${esc(tc.name)}</span>
        <span class="lg-tool-desc">args: ${esc(JSON.stringify(tc.args, null, 2).slice(0, 50))}</span>
      </div>`).join("") || "Nenhuma ferramenta";
  } else {
    toolsEl.textContent = "Nenhuma ferramenta executada";
  }
}

/* ---------- observabilidade ---------- */
async function loadObservability() {
  const [infra, events, costs] = await Promise.all([
    api("/infra/status").catch(() => null),
    api("/events").catch(() => null),
    api("/costs").catch(() => null),
  ]);

  const mon = infra?.monitors ?? [];
  const ollamaOk = !!(infra && infra.ollama && infra.ollama.ok);
  const sys = infra?.system;
  const pg = infra?.postgres;
  const dbs = infra?.databases;
  const rag = infra?.rag;

  /* --- cards infra --- */
  let cards = "";

  /* Daemon */
  cards += `<div class="stat-card"><div class="label">${ic("pulse")} Daemon</div><div class="value">${infra ? esc(infra.service) : "offline"}</div><div class="sub">${infra ? `${infra.souls.total} souls` : "fora do ar"}</div></div>`;

  /* Ollama */
  cards += `<div class="stat-card"><div class="label">${ic("graph")} Ollama</div><div class="value" style="color:${ollamaOk ? "#00ff9d" : "#ff2a2a"}">${ollamaOk ? "online" : "offline"}</div><div class="sub">${infra && infra.ollama ? `${infra.ollama.models} modelos · ${infra.ollama.latencyMs}ms` : "sem resposta /api/tags"}</div></div>`;

  /* Sistema (Linux) */
  if (sys) {
    const ramPct = sys.ramTotal > 0 ? Math.round((sys.ramUsed / sys.ramTotal) * 100) : 0;
    const diskPct = sys.diskTotal > 0 ? Math.round((sys.diskUsed / sys.diskTotal) * 100) : 0;
    const uptimeH = Math.floor(sys.uptime / 3600);
    const uptimeM = Math.floor((sys.uptime % 3600) / 60);
    cards += `<div class="stat-card"><div class="label">${ic("dashboard")} Sistema</div><div class="value" style="color:${sys.cpuPercent > 80 ? "#ff2a2a" : sys.cpuPercent > 50 ? "#ffb800" : "#00ff9d"}">${sys.cpuPercent}% CPU</div><div class="sub">${sys.cpuCount}x ${esc(sys.cpuModel.slice(0, 30))} · load ${sys.loadAvg[0]}</div></div>`;
    cards += `<div class="stat-card"><div class="label">${ic("memory")} RAM</div><div class="value" style="color:${ramPct > 85 ? "#ff2a2a" : ramPct > 60 ? "#ffb800" : "#00ff9d"}">${ramPct}%</div><div class="sub">${fmtBytes(sys.ramUsed)} / ${fmtBytes(sys.ramTotal)}</div></div>`;
    if (sys.diskTotal > 0) {
      cards += `<div class="stat-card"><div class="label">${ic("dashboard")} Disco</div><div class="value" style="color:${diskPct > 90 ? "#ff2a2a" : diskPct > 75 ? "#ffb800" : "#00ff9d"}">${diskPct}%</div><div class="sub">${fmtBytes(sys.diskUsed)} / ${fmtBytes(sys.diskTotal)}</div></div>`;
    }
    cards += `<div class="stat-card"><div class="label">${ic("pulse")} Uptime</div><div class="value">${uptimeH}h ${uptimeM}m</div><div class="sub">${esc(sys.platform)} ${esc(sys.arch)}</div></div>`;
  }

  /* Postgres */
  if (pg) {
    cards += `<div class="stat-card"><div class="label">${ic("graph")} Postgres</div><div class="value">${pg.tables} tabelas</div><div class="sub">${pg.connections} conexões ativas · ${pg.version.slice(0, 40)}</div></div>`;
  }

  /* kernel.db / memory.db */
  if (dbs) {
    cards += `<div class="stat-card"><div class="label">${ic("memory")} kernel.db</div><div class="value">${fmtBytes(dbs.kernelBytes)}</div><div class="sub">memory.db: ${fmtBytes(dbs.memoryBytes)}</div></div>`;
  }

  /* RAG */
  if (rag) {
    cards += `<div class="stat-card"><div class="label">${ic("graph")} RAG</div><div class="value">${rag.chunks} chunks</div><div class="sub">embedder + grafo no Postgres</div></div>`;
  }

  /* Eventos */
  if (infra?.events) {
    cards += `<div class="stat-card"><div class="label">${ic("dashboard")} Eventos</div><div class="value">${infra.events.pending + infra.events.processing}</div><div class="sub">${infra.events.completed} ok · ${infra.events.failed} falhas</div></div>`;
  }

  /* Sites */
  cards += `<div class="stat-card"><div class="label">${ic("pulse")} Sites</div><div class="value">${mon.length}</div><div class="sub">${mon.filter((m) => m.status === "up").length} up · ${mon.filter((m) => m.status === "down").length} down</div></div>`;

  $("#infra-cards").innerHTML = cards;

  const eventsBox = $("#events-box");
  if (events) {
    const stats = events.stats || {};
    eventsBox.innerHTML = `
      <div style="margin-bottom:8px">
        ${["pending", "processing", "completed", "failed"]
          .map((k) => `<span class="chip ${k === "failed" && stats[k] > 0 ? "fail" : k === "completed" && stats[k] > 0 ? "ok" : ""}">${esc(k)}: ${stats[k] ?? 0}</span>`)
          .join("")}
      </div>
      ${
        events.recent.length
          ? events.recent
              .map(
                (e) => `
              <div class="cost-row">
                <span class="soul" style="flex:0 0 60px">#${e.id}</span>
                <span class="mono" style="flex:1">${esc(e.type)}</span>
                <span class="chip ${e.status === "completed" ? "ok" : e.status === "failed" ? "fail" : ""}">${esc(e.status)}</span>
                <span class="cost-val">${fmtTs(e.ts)}</span>
              </div>`,
              )
              .join("")
          : `<span class="muted">nenhum evento recebido ainda (POST /events exige ASSISTENTE_OS_WEBHOOK_SECRET)</span>`
      }`;
  } else {
    eventsBox.innerHTML = `<span class="muted">eventos indisponíveis</span>`;
  }

  const execBox = $("#executions-box");
  const execs = infra?.executions ?? [];
  execBox.innerHTML = execs.length
    ? execs
        .map(
          (x) => `
        <div class="cost-row">
          <span class="soul" style="flex:0 0 100px">${esc(x.soul)}</span>
          <span class="chip ${x.status === "ok" ? "ok" : "fail"}">${esc(x.status)}</span>
          <span class="mono" style="flex:1">${esc(x.kind)}</span>
          <span class="cost-val">${x.contextChars} chars</span>
          <span class="cost-val">${fmtTs(x.ts)}</span>
        </div>`,
        )
        .join("")
    : `<span class="muted">nenhuma execução registrada ainda</span>`;

  /* --- Custos --- */
  const costsBox = $("#costs-box");
  if (costsBox && costs) {
    const bySoul = costs.bySoul ?? {};
    const recent = costs.recent ?? [];
    const soulEntries = Object.entries(bySoul).sort((a, b) => b[1] - a[1]);
    costsBox.innerHTML = `
      <div class="costs-section">
        <h3>Custo por soul</h3>
        ${soulEntries.length
          ? `<table class="costs-table">
              <thead><tr><th>Soul</th><th>Gasto</th></tr></thead>
              <tbody>${soulEntries.map(([s, v]) => `<tr><td>${esc(s)}</td><td>$${v.toFixed(4)}</td></tr>`).join("")}</tbody>
            </table>`
          : `<span class="muted">nenhum custo registrado</span>`}
      </div>
      <div class="costs-section">
        <h3>Chamadas recentes</h3>
        ${recent.length
          ? `<table class="costs-table">
              <thead><tr><th>Soul</th><th>Tier</th><th>Status</th><th>Data</th></tr></thead>
              <tbody>${recent.map((c) => `<tr><td>${esc(c.soul)}</td><td>${esc(c.provider ?? "—")}</td><td><span class="chip ${c.status === "ok" ? "ok" : "fail"}">${esc(c.status)}</span></td><td>${fmtTs(c.ts)}</td></tr>`).join("")}</tbody>
            </table>`
          : `<span class="muted">nenhuma chamada registrada</span>`}
      </div>`;
  }

  await renderMonitors();
}

/* ---------- monitor de sites ---------- */
async function renderMonitors() {
  const monitors = await api("/monitors").catch(() => []);
  const box = $("#monitors-box");
  if (!monitors.length) {
    box.innerHTML = `<span class="muted">nenhum site monitorado. Adicione acima e clique em "Checar agora".</span>`;
    return;
  }
  box.innerHTML = monitors
    .map(
      (m) => `
      <div class="cost-row">
        <span class="soul" style="flex:0 0 150px" title="${esc(m.url)}">${esc(m.name)}</span>
        <span class="mono" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(m.url)}</span>
        <span class="chip ${m.status === "up" ? "ok" : m.status === "down" ? "fail" : ""}">${esc(m.status)}${m.latencyMs != null ? ` · ${Math.round(m.latencyMs)}ms` : ""}</span>
        ${m.httpCode != null ? `<span class="chip">HTTP ${m.httpCode}</span>` : ""}
        <span class="cost-val">${m.lastCheckedAt ? fmtTs(m.lastCheckedAt) : "nunca"}</span>
        <button data-del="${m.id}" class="monitor-del" title="remover">✕</button>
      </div>
      ${m.lastError ? `<div class="muted" style="font-size:11px;margin:-2px 0 4px">${esc(m.lastError)}</div>` : ""}`,
    )
    .join("");
  box.querySelectorAll(".monitor-del").forEach((b) => {
    b.addEventListener("click", async () => {
      await api(`/monitors/${b.dataset.del}`, { method: "DELETE" }).catch(() => {});
      renderMonitors();
    });
  });
}

$("#monitor-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("#monitor-name").value.trim();
  const url = $("#monitor-url").value.trim();
  const code = parseInt($("#monitor-code").value, 10);
  if (!name || !url) {
    alert("preencha nome e URL");
    return;
  }
  try {
    await api("/monitors", {
      method: "POST",
      body: JSON.stringify({ name, url, expectedCode: Number.isFinite(code) ? code : 200 }),
    });
    $("#monitor-name").value = "";
    $("#monitor-url").value = "";
    await renderMonitors();
  } catch (err) {
    alert(err.message);
  }
});

$("#monitor-check").addEventListener("click", async () => {
  const btn = $("#monitor-check");
  btn.disabled = true;
  btn.textContent = "checando…";
  try {
    await api("/monitors/check", { method: "POST" });
    await renderMonitors();
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Checar agora";
  }
});

/* ---------- llm e mcp ---------- */
async function loadLlm() {
  const box = $("#llm-list");
  box.innerHTML = `<span class="muted">Carregando modelos Ollama...</span>`;
  try {
    const infra = await api("/infra/status").catch(() => null);
    if (!infra || !infra.ollama || !infra.ollama.ok) {
      box.innerHTML = `<span class="muted">Ollama indisponível ou sem resposta.</span>`;
      return;
    }
    // We mock models since we only get counts from infra.ollama.models
    box.innerHTML = `
      <div class="result-item" style="border-color: var(--neon-cyan)">
         <div class="result-head"><span class="chip ok">ativo</span><span class="mono">${esc(state.tier)}</span></div>
         <div class="result-body">Modelo carregado em memória (${infra.ollama.latencyMs}ms de latência)</div>
      </div>
      <div class="muted" style="margin-top:10px">${infra.ollama.models} modelos instalados no total.</div>
    `;
  } catch (err) {
    box.innerHTML = `<span class="muted">erro: ${esc(err.message)}</span>`;
  }
}

async function loadMcp() {
  const box = $("#mcp-list");
  const tools = [
    { name: "memory_search", cat: "Memória", desc: "Busca vetorial na memória da soul com gate de relevância." },
    { name: "memory_index", cat: "Memória", desc: "Indexa (idempotente) a pasta da soul no memory.db." },
    { name: "memory_status", cat: "Memória", desc: "Contagem de chunks e grafo (entidades/relações/observações) da soul." },
    { name: "graph_list", cat: "Grafo", desc: "Lista entidades, relações e observações do grafo da soul." },
    { name: "observation_add", cat: "Grafo", desc: "Adiciona uma observação ao grafo da soul." },
    { name: "soul_anotar", cat: "Soul", desc: "Anota um item cronológico na sessão do dia da soul." },
    { name: "soul_licao", cat: "Soul", desc: "Registra uma lição aprendida em licoes.md da soul." },
    { name: "soul_decidir", cat: "Soul", desc: "Grava uma decisão no formato ADR em decisoes/<data>-<slug>.md da soul." },
    { name: "agenda_add", cat: "Agenda", desc: "Agenda uma tarefa para o daemon despachar." },
    { name: "agenda_list", cat: "Agenda", desc: "Lista itens da agenda por status." },
    { name: "costs_summary", cat: "Custos", desc: "Resumo de custos por soul e últimas chamadas do kernel.db." },
  ];
  const grouped = {};
  for (const t of tools) {
    (grouped[t.cat] ??= []).push(t);
  }
  const cats = Object.keys(grouped);
  box.innerHTML = cats.map((cat) => `
    <div style="margin-bottom:10px">
      <div style="font-size:0.6rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">${esc(cat)}</div>
      ${grouped[cat].map((t) => `
        <div class="result-item">
          <div class="result-head"><span class="chip ok">langgraph</span><span class="mono">${esc(t.name)}</span></div>
          <div class="result-body">${esc(t.desc)}</div>
        </div>`).join("")}
    </div>`).join("") + `<div class="muted" style="margin-top:10px">12 tools LangChain disponíveis via tier langgraph.</div>`;
}

/* ---------- status pill ---------- */
async function refreshStatus() {
  try {
    const health = await api("/health");
    const pill = $("#status-pill");
    pill.textContent = "online";
    pill.className = "pill pill-ok";
    $("#daemon-info").textContent = `daemon: ${health.service} · ${health.souls.length} souls`;
  } catch {
    const pill = $("#status-pill");
    pill.textContent = "offline";
    pill.className = "pill pill-err";
    $("#daemon-info").textContent = "daemon: offline";
  }
}

/* ---------- voice ---------- */
let voiceActive = false;

async function toggleVoice() {
  if (!state.active) {
    addMsg("err", "Selecione uma soul na sidebar antes de ativar a voz.");
    return;
  }

  const btn = $("#voice-toggle");
  const status = $("#voice-status");
  const iconOff = $("#voice-icon-off");
  const iconOn = $("#voice-icon-on");
  const transcript = $("#voice-transcript");

  if (voiceActive) {
    try {
      await api(`/voice/stop`, { method: "POST" });
      voiceActive = false;
      btn.classList.remove("active");
      iconOff.style.display = "";
      iconOn.style.display = "none";
      status.textContent = "Voz: off";
      transcript.style.display = "none";
    } catch (err) {
      addMsg("err", `Erro ao parar voz: ${esc(err.message)}`);
    }
  } else {
    try {
      await api(`/voice/start`, {
        method: "POST",
        body: JSON.stringify({ soul: state.active }),
      });
      voiceActive = true;
      btn.classList.add("active");
      iconOff.style.display = "none";
      iconOn.style.display = "";
      status.textContent = "Voz: ouvindo...";
      transcript.style.display = "block";
      transcript.textContent = "Aguardando fala...";
      addMsg("meta", "Voz ativada. Fale no microfone.");
    } catch (err) {
      addMsg("err", `Erro ao iniciar voz: ${esc(err.message)}`);
    }
  }
}

function updateVoiceStatus(status) {
  const el = $("#voice-status");
  if (!el) return;
  
  switch (status) {
    case "listening":
      el.textContent = "Voz: ouvindo...";
      break;
    case "speech-detected":
      el.textContent = "Voz: fala detectada";
      break;
    case "transcribing":
      el.textContent = "Voz: transcrevendo...";
      break;
    case "speaking":
      el.textContent = "Voz: respondendo...";
      break;
    case "idle":
      el.textContent = "Voz: aguardando...";
      break;
    default:
      el.textContent = `Voz: ${status}`;
  }
}

function showVoiceTranscript(text, kind = "user") {
  const el = $("#voice-transcript");
  if (!el) return;
  
  if (kind === "user") {
    el.innerHTML = `<span style="color: var(--neon-cyan);">Você:</span> ${esc(text)}`;
  } else {
    el.innerHTML = `<span style="color: var(--neon-green);">Resposta:</span> ${esc(text)}`;
  }
}

/* ---------- boot ---------- */
async function boot() {
  await ensureToken();
  connectWs();
  refreshStatus();
  try {
    await loadSouls();
    if (state.souls.length && !state.active) selectSoul(state.souls[0].id);
  } catch {
    /* souls indisponíveis; sidebar continua vazia */
  }
  loadDashboard();
  
  // Voice toggle button
  $("#voice-toggle")?.addEventListener("click", toggleVoice);
  
  // WebSocket voice events
  const origWsOnmessage = ws?.onmessage;
  if (ws) {
    const origHandler = ws.onmessage;
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "voice.status") {
          updateVoiceStatus(msg.status);
        } else if (msg.type === "voice.transcribed") {
          showVoiceTranscript(msg.text, "user");
          sendChat(msg.text);
        } else if (msg.type === "voice.spoken") {
          showVoiceTranscript(msg.text, "soul");
        }
      } catch {}
      origHandler(e);
    };
  }
}
boot();