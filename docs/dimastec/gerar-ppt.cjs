const pptxgen = require("pptxgenjs");

const NAVY = "1F2761";
const BLUE = "2E74B5";
const LIGHTBLUE = "DCE7F5";
const SLATE = "3C4858";
const GOLD = "C9A227";
const WHITE = "FFFFFF";
const MUTED = "6B7280";

const pptx = new pptxgen();
pptx.layout = "LAYOUT_WIDE"; // 13.33 x 7.5

const FONT = "Calibri";

// ---------- helpers ----------
function slideHeader(slide, opts = {}) {
  // Rótulo de seção (canto sup. esquerdo) + título grande
  const { tag, title } = opts;
  slide.addShape("rect", {
    x: 0.6, y: 0.45, w: 0.12, h: 0.5, fill: { color: GOLD },
  });
  slide.addText(tag, {
    x: 0.9, y: 0.42, w: 11.5, h: 0.4, fontSize: 13, bold: true,
    color: BLUE, charSpacing: 2, fontFace: FONT,
  });
  slide.addText(title, {
    x: 0.9, y: 0.72, w: 11.5, h: 0.7, fontSize: 30, bold: true,
    color: NAVY, fontFace: FONT,
  });
}

function addFooter(slide, page) {
  slide.addText("Sousa Lima Consultoria · Dimastec · Como Construir um Agente de IA", {
    x: 0.6, y: 7.05, w: 9, h: 0.3, fontSize: 9, color: MUTED, fontFace: FONT,
  });
  slide.addText(String(page), {
    x: 12.3, y: 7.05, w: 0.5, h: 0.3, fontSize: 9, color: MUTED, align: "right", fontFace: FONT,
  });
}

function pill(slide, x, y, w, text, fill, color = WHITE, size = 11) {
  slide.addShape("roundRect", {
    x, y, w, h: 0.34, rectRadius: 0.17, fill: { color: fill },
    line: { color: fill, width: 0.5 },
  });
  slide.addText(text, { x, y: y - 0.01, w, h: 0.36, align: "center", fontSize: size, bold: true, color, fontFace: FONT, valign: "middle" });
}

function stepSlide(slide, opts) {
  const { num, title, claude, refs, chips } = opts;
  slide.background = { color: WHITE };
  slideHeader(slide, { tag: "Passo " + num, title });

  // Número decorativo grande à direita
  slide.addText(num, {
    x: 10.9, y: 0.35, w: 1.9, h: 1.6, fontSize: 120, bold: true, color: LIGHTBLUE, fontFace: FONT,
  });

  // Coluna esquerda: Como fazer com Claude Code
  slide.addShape("roundRect", {
    x: 0.9, y: 1.75, w: 6.0, h: 4.85, rectRadius: 0.12,
    fill: { color: WHITE }, line: { color: LIGHTBLUE, width: 1.2 },
    shadow: { type: "outer", color: "000000", opacity: 0.12, blur: 7, offset: 2, angle: 90 },
  });
  slide.addText("COMO FAZER COM CLAUDE CODE", {
    x: 1.2, y: 1.95, w: 5.4, h: 0.35, fontSize: 12, bold: true, color: BLUE, charSpacing: 1.5, fontFace: FONT,
  });
  claude.forEach((line, i) => {
    slide.addText(line, {
      x: 1.2, y: 2.45 + i * 0.72, w: 5.4, h: 0.68, fontSize: 13, color: SLATE, fontFace: FONT, valign: "top",
    });
  });

  // Coluna direita: Referência assistente-os
  slide.addShape("roundRect", {
    x: 7.15, y: 1.75, w: 5.3, h: 4.85, rectRadius: 0.12,
    fill: { color: NAVY },
    shadow: { type: "outer", color: "000000", opacity: 0.15, blur: 7, offset: 2, angle: 90 },
  });
  slide.addText("REFERÊNCIA · ASSISTENTE-OS", {
    x: 7.45, y: 1.95, w: 4.7, h: 0.35, fontSize: 12, bold: true, color: WHITE, charSpacing: 1.5, fontFace: FONT,
  });
  refs.forEach((line, i) => {
    slide.addText("•  " + line, {
      x: 7.45, y: 2.45 + i * 0.72, w: 4.7, h: 0.68, fontSize: 12.5, color: WHITE, fontFace: FONT, valign: "top",
    });
  });

  // Chips inferiores
  if (chips) {
    let cx = 0.9;
    chips.forEach((c) => {
      const w = c.length * 0.082 + 0.5;
      pill(slide, cx, 6.78, w, c, LIGHTBLUE, BLUE, 10.5);
      cx += w + 0.18;
    });
  }
  addFooter(slide, opts.page);
}

// ============================================================
// SLIDE 1 — CAPA
// ============================================================
{
  const s = pptx.addSlide();
  s.background = { color: NAVY };
  s.addShape("rect", { x: 0, y: 0, w: 0.25, h: 7.5, fill: { color: GOLD } });
  s.addShape("ellipse", { x: 10.4, y: -1.6, w: 5.5, h: 5.5, fill: { color: "24307A" }, line: { type: "none" } });
  s.addShape("ellipse", { x: 11.6, y: 4.6, w: 4.4, h: 4.4, fill: { color: "28357F" }, line: { type: "none" } });

  s.addText("COMO CONSTRUIR UM AGENTE DE IA", {
    x: 1.0, y: 1.35, w: 11.5, h: 0.5, fontSize: 15, bold: true, color: GOLD, charSpacing: 3, fontFace: FONT,
  });
  s.addText("Demonstração ao Cliente", {
    x: 1.0, y: 2.0, w: 11, h: 1.4, fontSize: 44, bold: true, color: WHITE, fontFace: FONT,
  });
  s.addText("As 8 etapas do método aplicadas ao assistente técnico do Saturno-Calc / MYDAS", {
    x: 1.0, y: 3.35, w: 10.5, h: 0.9, fontSize: 19, color: LIGHTBLUE, fontFace: FONT,
  });

  s.addText("Dimastec", { x: 1.0, y: 5.0, w: 6, h: 0.5, fontSize: 20, bold: true, color: WHITE, fontFace: FONT });
  s.addText("Para o CTO · Natanael Morais", { x: 1.0, y: 5.5, w: 6, h: 0.4, fontSize: 15, color: LIGHTBLUE, fontFace: FONT });

  s.addShape("rect", { x: 1.0, y: 6.35, w: 3.2, h: 0.035, fill: { color: GOLD } });
  s.addText("Sousa Lima Consultoria · Everton Lima · 29 de agosto de 2026", {
    x: 1.0, y: 6.55, w: 11, h: 0.4, fontSize: 12, color: LIGHTBLUE, fontFace: FONT,
  });
}

// ============================================================
// SLIDE 2 — OBJETIVO & AGENDA
// ============================================================
{
  const s = pptx.addSlide();
  s.background = { color: WHITE };
  slideHeader(s, { tag: "ABERTURA", title: "Objetivo e agenda da sessão" });

  // Coluna esquerda: resultado esperado
  s.addShape("roundRect", { x: 0.9, y: 1.75, w: 6.1, h: 4.9, rectRadius: 0.1, fill: { color: LIGHTBLUE }, line: { type: "none" } });
  s.addText("RESULTADO ESPERADO", { x: 1.2, y: 1.95, w: 5.5, h: 0.35, fontSize: 12, bold: true, color: BLUE, charSpacing: 1.5, fontFace: FONT });
  const results = [
    "CTO vê um agente em funcionamento aplicado ao contexto real da Dimastec — não um guia teórico.",
    "Valida o método das 8 etapas como padrão para os demais casos de uso.",
    "Fecha um próximo passo concreto: o piloto do assistente técnico read-only.",
  ];
  results.forEach((r, i) => {
    s.addShape("circle", { x: 1.25, y: 2.75 + i * 1.25, w: 0.5, h: 0.5, fill: { color: NAVY } });
    s.addText(String(i + 1), { x: 1.25, y: 2.78 + i * 1.25, w: 0.5, h: 0.44, align: "center", fontSize: 16, bold: true, color: WHITE, fontFace: FONT, valign: "middle" });
    s.addText(r, { x: 1.95, y: 2.7 + i * 1.25, w: 4.8, h: 0.95, fontSize: 14, color: SLATE, fontFace: FONT, valign: "top" });
  });

  // Coluna direita: agenda 60 min
  const agenda = [
    ["10 min", "Contexto: o método das 8 etapas"],
    ["25 min", "Demo ao vivo do assistente técnico"],
    ["10 min", "Governança e guardrails na prática"],
    ["10 min", "Evals e como medir qualidade"],
    ["5 min", "Próximos passos e piloto"],
  ];
  let y = 1.85;
  agenda.forEach(([t, desc], i) => {
    s.addText(String(i + 1), { x: 7.35, y, w: 0.4, h: 0.6, fontSize: 22, bold: true, color: BLUE, fontFace: FONT });
    s.addText(t, { x: 7.9, y: y + 0.02, w: 1.1, h: 0.6, fontSize: 17, bold: true, color: NAVY, fontFace: FONT, valign: "middle" });
    s.addText("min", { x: 8.95, y: y + 0.14, w: 0.5, h: 0.4, fontSize: 11, color: MUTED, fontFace: FONT, valign: "middle" });
    s.addText(desc, { x: 9.5, y: y + 0.02, w: 2.9, h: 0.6, fontSize: 13, color: SLATE, fontFace: FONT, valign: "middle" });
    if (i < 4) s.addShape("line", { x: 7.35, y: y + 0.78, w: 5.05, h: 0, line: { color: LIGHTBLUE, width: 1 } });
    y += 0.95;
  });
  addFooter(s, 2);
}

// ============================================================
// SLIDE 3 — VISÃO GERAL (AS 8 ETAPAS)
// ============================================================
{
  const s = pptx.addSlide();
  s.background = { color: WHITE };
  slideHeader(s, { tag: "MÉTODO", title: "As 8 etapas do guia em um só fluxo" });

  const steps = [
    ["0", "Setup & Segurança"],
    ["1", "System Prompt"],
    ["2", "Escolher o LLM"],
    ["3", "Ferramentas (MCP)"],
    ["4", "Memória (RAG)"],
    ["5", "Orquestração"],
    ["6", "Interface"],
    ["7", "Testes & Evals"],
  ];
  const cols = 4, rows = 2;
  const cw = 2.75, chh = 2.1, gx = 0.25, gy = 0.3;
  const ox = 0.9, oy = 1.85;
  steps.forEach(([n, name], i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const x = ox + col * (cw + gx), y = oy + row * (chh + gy);
    const isSpecial = n === "0" || n === "7";
    const fill = isSpecial ? NAVY : LIGHTBLUE;
    const numColor = isSpecial ? GOLD : BLUE;
    const txtColor = isSpecial ? WHITE : SLATE;
    s.addShape("roundRect", { x, y, w: cw, h: chh, rectRadius: 0.08, fill: { color: fill }, line: { type: "none" }, shadow: { type: "outer", color: "000000", opacity: 0.12, blur: 6, offset: 2, angle: 90 } });
    s.addText(n, { x, y: y + 0.15, w: cw, h: 0.8, align: "center", fontSize: 40, bold: true, color: numColor, fontFace: FONT });
    s.addText(name, { x: x + 0.2, y: y + 1.0, w: cw - 0.4, h: 0.9, align: "center", fontSize: 15.5, bold: true, color: txtColor, fontFace: FONT, valign: "top" });
    // seta
    if (col < cols - 1) {
      s.addText("›", { x: x + cw - 0.05, y: y + chh / 2 - 0.3, w: 0.5, h: 0.6, fontSize: 30, bold: true, color: BLUE, fontFace: FONT, align: "center", valign: "middle" });
    }
  });
  s.addText("Ordem pensada para valor rápido (MCP + RAG respondem no dia 1) e segurança antes de escala (guardrails e evals desde o início).", {
    x: 0.9, y: 6.45, w: 11.5, h: 0.4, fontSize: 12.5, italic: true, color: MUTED, fontFace: FONT, align: "center",
  });
  addFooter(s, 3);
}

// ============================================================
// SLIDES 4-11 — PASSOS
// ============================================================
{
  const s = pptx.addSlide();
  s.background = { color: WHITE };
  stepSlide(s, {
    num: "0", page: 4,
    title: "Setup, escopo e barreiras de segurança",
    chips: ["read-only", "guardrails", "classificação IA"],
    claude: [
      "Defina o propósito em 1 linha: tirar dúvidas do time sobre o Saturno/MYDAS lendo ADRs e código — sem escrever e sem tocar produção.",
      "Defina o critério de sucesso: resposta certa + cita a fonte de onde tirou.",
      "Fixe os guardrails mínimos: proibido escrever, proibido dados de produção, sempre citar fonte. Classifique o caso como IA aplicada (não-dados sensíveis).",
      "Revise com o CTO os limites antes de qualquer código.",
    ],
    refs: [
      "Cada soul declara propósitos e permissões em config.",
      "O runtime aplica allowlist de ferramentas e nega o resto por padrão (fail-closed).",
      "Alinhado à POL-IA-001 e à classificação de casos de uso da Dimastec.",
    ],
  });
}
{
  const s = pptx.addSlide();
  s.background = { color: WHITE };
  stepSlide(s, {
    num: "1", page: 5,
    title: "System Prompt — o comando que define o agente",
    chips: ["persona", "regras", "guardrails em texto"],
    claude: [
      "No Claude Code, o prompt mora no arquivo de instruções do projeto/agente (ex.: AGENTS.md ou o prompt do subagente).",
      "Persona: arquiteto sênior de Java que conhece o Saturno/MYDAS e responde em português com fonte.",
      "Instruções: explicar a migração procedure → Java, citar camadas/patterns do hub (DAO, @Secured, route handler), responder só com base no material indexado.",
      "Guardrails visíveis: nunca escrever, nunca acessar produção, dizer “não sei” se o RAG não achar, citar a fonte.",
    ],
    refs: [
      "Pool de prompts versionado (prompt-garden) — montagem determinística.",
      "Persona no início do prompt; sessão/RAG/histórico na cauda.",
      "Evita alucinação ao restringir a base de conhecimento.",
    ],
  });
}
{
  const s = pptx.addSlide();
  s.background = { color: WHITE };
  stepSlide(s, {
    num: "2", page: 6,
    title: "Escolher o modelo (LLM) com visão de custo",
    chips: ["custo/1M tokens", "janela de contexto", "ADR"],
    claude: [
      "Documentação densa (ADR + código) pede janela de contexto ampla e bom raciocínio.",
      "Compare 2–3 modelos antes de fixar: custo por 1M de tokens (entrada/saída), janela, latência e qualidade em PT-BR técnico.",
      "No Claude Code, decida o modelo do agente e acompanhe o custo do uso.",
      "Entregável: tabela com 2 modelos + decisão registrada em 1 ADR.",
    ],
    refs: [
      "O roteador escolhe o modelo por tier e mede o custo por chamada.",
      "Custo imutável rastreado por chamada (kernel.db).",
      "Transparência de custo para o cliente desde a escolha.",
    ],
  });
}
{
  const s = pptx.addSlide();
  s.background = { color: WHITE };
  stepSlide(s, {
    num: "3", page: 7,
    title: "Ferramentas & Integrações (MCP)",
    chips: ["MCP", "read-only", "allowlist"],
    claude: [
      "A Dimastec já tem servidor MCP interno — conecte-o agora.",
      "Exponha ferramentas somente-leitura: busca na base de conhecimento (RAG), leitura de ADR, leitura de código.",
      "No Claude Code, as ferramentas MCP entram no mesmo arquivo de configuração do projeto.",
      "Teste ao vivo: uma chamada MCP que busca um trecho de ADR e responde citando o arquivo.",
    ],
    refs: [
      "Kernel expõe ferramentas MCP sobre stdio com classificação L1/L2/L3.",
      "A soul só enxerga as ferramentas da sua allowlist.",
      "Zero Trust: ferramentas de escrita bloqueadas por padrão.",
    ],
  });
}
{
  const s = pptx.addSlide();
  s.background = { color: WHITE };
  stepSlide(s, {
    num: "4", page: 8,
    title: "Memória (RAG + histórico)",
    chips: ["vetorial", "allowlist", "sem dados sensíveis"],
    claude: [
      "O assistente precisa lembrar do contexto sem ter tudo no prompt a cada vez.",
      "Indexe documentos aprovados (allowlist): ADRs do Saturno, políticas (ISO 27001/LGPD/POL-IA-001) e código sanitizado — sem dados de produção.",
      "Persista o histórico por thread/sessão para conversas contínuas.",
      "Quando o RAG não acha nada, responder “sem contexto” em vez de inventar.",
    ],
    refs: [
      "RAG com embeddings + re-rank multilíngue opcional e cache semântico.",
      "Cita a fonte no formato [doc · similaridade · data] com score de confiança; abaixo do limiar, responde “evidência insuficiente”.",
      "Política de memória impede indexar dados sensíveis.",
    ],
  });
}
{
  const s = pptx.addSlide();
  s.background = { color: WHITE };
  stepSlide(s, {
    num: "5", page: 9,
    title: "Orquestração — o fluxo do agente",
    chips: ["retrieve", "generate", "tools", "retry"],
    claude: [
      "Defina o caminho: entende a pergunta → recupera contexto (RAG) → decide se usa ferramenta → responde.",
      "Modos por complexidade: pergunta curta → resposta rápida; “passo a passo”/“análise” → fluxo mais profundo.",
      "Decida quando ele pode chamar ferramenta e o que fazer em erro (limite de tentativas, timeout, dizer “não consegui”).",
    ],
    refs: [
      "Grafo LangGraph: retrieve → generate ↷ tools com limite de iterações.",
      "Streaming por etapa (cada node emite evento).",
      "Escalonamento quando o contexto é fraco.",
    ],
  });
}
{
  const s = pptx.addSlide();
  s.background = { color: WHITE };
  stepSlide(s, {
    num: "6", page: 10,
    title: "Interface — como o time vai usar",
    chips: ["terminal/IDE", "web", "API"],
    claude: [
      "Fase 1: chat no terminal/IDE (Claude Code) sendo o próprio assistente, com prompt + MCP configurados.",
      "Fase 2: interface web de chat para o time, com histórico por usuário.",
      "Fase 3 (opcional): API para integrar ao fluxo de suporte existente.",
      "Comece simples; evolua a interface conforme uso real.",
    ],
    refs: [
      "Chat via REST/WebSocket com streaming etapa-a-etapa.",
      "Painel web mostra o grafo rodando ao vivo.",
      "Ideia para o CTO: ver o agente “pensar” em tempo real.",
    ],
  });
}
{
  const s = pptx.addSlide();
  s.background = { color: WHITE };
  stepSlide(s, {
    num: "7", page: 11,
    title: "Testes & Evals — qualidade mensurável",
    chips: ["golden set", "hit@1", "MRR", "gate CI"],
    claude: [
      "Sem eval não há como provar que o assistente melhora ao longo do tempo.",
      "Monte um golden set real do Saturno: ex. “qual o padrão de DAO multi-tenant?” → citar o ADR/pattern; “todo endpoint precisa de @Secured?” → sim, pelos rules.",
      "Meça hit@1 (doc certo em 1º?), MRR e recall@5 + fidelidade ao contexto (não alucinar) e taxa de recusa em perguntas adversariais.",
      "Gate no CI: pergunta abaixo do piso (ex.: hit@1 ≥ 0.7) bloqueia o release.",
    ],
    refs: [
      "Comando de avaliação de RAG com golden set (hit@1/MRR/recall + taxa de recusa adversarial), com histórico de execuções.",
      "Sai com erro se o piso não for atingido — gate em CI.",
      "Já preparamos um golden set inicial com 23 casos a partir da documentação do hub — ponto de partida a expandir.",
    ],
  });
}

// ============================================================
// SLIDE 12 — SEQUÊNCIA-RESUMO
// ============================================================
{
  const s = pptx.addSlide();
  s.background = { color: NAVY };
  s.addText("8 ETAPAS EM 7 MOVIMENTOS", {
    x: 1.0, y: 0.6, w: 11, h: 0.5, fontSize: 14, bold: true, color: GOLD, charSpacing: 3, fontFace: FONT,
  });
  s.addText("A ordem certa para o CTO ver valor rápido e segurança desde o início", {
    x: 1.0, y: 1.1, w: 11.3, h: 0.8, fontSize: 30, bold: true, color: WHITE, fontFace: FONT,
  });

  const flow = [
    ["Escopo + Guardrails", "0"],
    ["Prompt", "1"],
    ["Modelo", "2"],
    ["MCP", "3"],
    ["Memória", "4"],
    ["Orquestração", "5"],
    ["Interface", "6"],
    ["Evals", "7"],
  ];
  const nc = 8;
  const cw = 1.3, gap = 0.12, ox = 0.7, oy = 2.6;
  flow.forEach(([name, n], i) => {
    const x = ox + i * (cw + gap);
    s.addShape("roundRect", { x, y: oy, w: cw, h: 1.9, rectRadius: 0.1, fill: { color: "24307A" }, line: { type: "none" }, shadow: { type: "outer", color: "000000", opacity: 0.2, blur: 6, offset: 2, angle: 90 } });
    s.addText(n, { x, y: oy + 0.12, w: cw, h: 0.5, align: "center", fontSize: 22, bold: true, color: GOLD, fontFace: FONT });
    s.addShape("line", { x: x + 0.25, y: oy + 0.7, w: cw - 0.5, h: 0, line: { color: GOLD, width: 1 } });
    s.addText(name, { x: x + 0.1, y: oy + 0.85, w: cw - 0.2, h: 0.9, align: "center", fontSize: 12.5, bold: true, color: WHITE, fontFace: FONT, valign: "top" });
    if (i < nc - 1) s.addText("›", { x: x + cw - 0.03, y: oy + 0.7, w: 0.3, h: 0.5, fontSize: 24, bold: true, color: GOLD, fontFace: FONT, align: "center" });
  });

  s.addText("Cada etapa fecha com um artefato mínimo: ADR · prompt versionado · tabela de modelo · allowlist · golden set.", {
    x: 1.0, y: 5.0, w: 11.3, h: 0.5, fontSize: 14, italic: true, color: LIGHTBLUE, fontFace: FONT, align: "center",
  });
  addFooter(s, 12);
  // footer dark
  s.addText("Sousa Lima Consultoria · Dimastec · Como Construir um Agente de IA", { x: 0.6, y: 7.05, w: 9, h: 0.3, fontSize: 9, color: "8FA0C8", fontFace: FONT });
}

// ============================================================
// SLIDE 13 — MENSAGENS-CHAVE
// ============================================================
{
  const s = pptx.addSlide();
  s.background = { color: WHITE };
  slideHeader(s, { tag: "GOVERNANÇA", title: "Mensagens-chave para o CTO" });
  const msgs = [
    ["Não é teoria", "É o mesmo fluxo que aplicamos no Saturno-Calc: propósito → LLM → ferramentas → memória → orquestração → evals."],
    ["Já em andamento", "MCP e Projeto Zero estão rolando; a Dimastec já usa Claude Code, Rovo e servidor MCP interno — a demo formaliza isso."],
    ["Governança embutida", "Cada etapa respeita ISO 27001 / LGPD / POL-IA-001 e a classificação de casos de uso (sem dados biométricos em runtime)."],
    ["Porta de entrada", "Esta demo abre caminho para o piloto do assistente técnico do Mês 3 da mentoria."],
  ];
  const cw = 5.6, chh = 2.3, gx = 0.4, gy = 0.4, ox = 0.9, oy = 1.8;
  msgs.forEach(([h, d], i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = ox + col * (cw + gx), y = oy + row * (chh + gy);
    s.addShape("roundRect", { x, y, w: cw, h: chh, rectRadius: 0.08, fill: { color: LIGHTBLUE }, line: { type: "none" } });
    s.addShape("circle", { x: x + 0.25, y: y + 0.25, w: 0.55, h: 0.55, fill: { color: NAVY } });
    s.addText(String(i + 1), { x: x + 0.25, y: y + 0.3, w: 0.55, h: 0.45, align: "center", fontSize: 17, bold: true, color: WHITE, fontFace: FONT, valign: "middle" });
    s.addText(h, { x: x + 1.0, y: y + 0.26, w: cw - 1.2, h: 0.5, fontSize: 19, bold: true, color: NAVY, fontFace: FONT, valign: "middle" });
    s.addText(d, { x: x + 0.3, y: y + 1.0, w: cw - 0.6, h: 1.15, fontSize: 13, color: SLATE, fontFace: FONT, valign: "top" });
  });
  addFooter(s, 13);
}

// ============================================================
// SLIDE 14 — PRÓXIMOS PASSOS
// ============================================================
{
  const s = pptx.addSlide();
  s.background = { color: NAVY };
  s.addText("PRÓXIMOS PASSOS", { x: 1.0, y: 0.6, w: 11, h: 0.5, fontSize: 14, bold: true, color: GOLD, charSpacing: 3, fontFace: FONT });
  s.addText("Do piloto à escala, com prazo e dono", { x: 1.0, y: 1.1, w: 11.3, h: 0.8, fontSize: 30, bold: true, color: WHITE, fontFace: FONT });

  const rows = [
    ["1", "Aprovar o piloto", "Assistente técnico read-only no escopo do Mês 3 da mentoria", "1 semana", "Everton + Natanael"],
    ["2", "Definir fontes aprovadas", "Allowlist de documentação, ADRs e tickets sanitizados", "2 semanas", "Everton"],
    ["3", "Métricas", "Baseline de qualidade e fidelidade do assistente", "2 semanas", "Everton + Natanael"],
    ["4", "Treinar multiplicadores", "Times de engenharia no método das 8 etapas", "Contínuo", "Sousa Lima"],
  ];
  let y = 2.0;
  rows.forEach(([n, a, d, p, w]) => {
    s.addShape("roundRect", { x: 0.9, y, w: 11.5, h: 1.0, rectRadius: 0.08, fill: { color: "24307A" }, line: { type: "none" } });
    s.addShape("circle", { x: 1.15, y: y + 0.25, w: 0.5, h: 0.5, fill: { color: GOLD } });
    s.addText(n, { x: 1.15, y: y + 0.3, w: 0.5, h: 0.4, align: "center", fontSize: 16, bold: true, color: NAVY, fontFace: FONT, valign: "middle" });
    s.addText(a, { x: 1.85, y: y + 0.16, w: 3.0, h: 0.5, fontSize: 16, bold: true, color: WHITE, fontFace: FONT, valign: "middle" });
    s.addText(d, { x: 4.95, y: y + 0.16, w: 4.6, h: 0.6, fontSize: 12.5, color: LIGHTBLUE, fontFace: FONT, valign: "middle" });
    s.addText(p, { x: 9.65, y: y + 0.16, w: 1.5, h: 0.5, fontSize: 13, bold: true, color: GOLD, fontFace: FONT, valign: "middle", align: "center" });
    s.addText(w, { x: 11.0, y: y + 0.16, w: 1.35, h: 0.5, fontSize: 10.5, color: LIGHTBLUE, fontFace: FONT, valign: "middle" });
    y += 1.14;
  });

  s.addText("Obrigado — vamos construir juntos.", { x: 1.0, y: 6.6, w: 11, h: 0.5, fontSize: 15, italic: true, color: LIGHTBLUE, fontFace: FONT, align: "center" });
  s.addText("Sousa Lima Consultoria · Everton Lima · everton@sousalimaconsultoria.com.br", { x: 0.6, y: 7.05, w: 11, h: 0.3, fontSize: 9, color: "8FA0C8", fontFace: FONT, align: "center" });
}

pptx.writeFile({ fileName: "/home/support/assistente-os/docs/dimastec/Plano-Demonstracao-Agente-IA-Dimastec-CTO.pptx" })
  .then(() => console.log("PPTX gerado"));
