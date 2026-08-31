const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun,
  Table, TableRow, TableCell, WidthType, ShadingType,
  AlignmentType, PageBreak, LevelFormat,
} = require("docx");

const AZUL = "1F4E79";
const AZUL_CLARO = "2E74B5";
const CINZA = "595959";
const FUNDO_CABECALHO = "2E74B5";
const BRANCO = "FFFFFF";

function celula(texto, { largura, negrito = false, cor = undefined, fundo = undefined, centralizado = false } = {}) {
  return new TableCell({
    width: { size: largura, type: WidthType.DXA },
    shading: fundo ? { type: ShadingType.CLEAR, fill: fundo } : undefined,
    children: [new Paragraph({
      alignment: centralizado ? AlignmentType.CENTER : AlignmentType.LEFT,
      children: [new TextRun({ text: String(texto), bold: negrito, color: cor, size: 20 })],
    })],
  });
}

function linhaCabecalho(textos, larguras) {
  return new TableRow({
    tableHeader: true,
    children: textos.map((t, i) =>
      celula(t, { largura: larguras[i], negrito: true, cor: BRANCO, fundo: FUNDO_CABECALHO })
    ),
  });
}

function linha(textos, larguras, centralizado = false) {
  return new TableRow({
    children: textos.map((t, i) => celula(t, { largura: larguras[i], centralizado })),
  });
}

const doc = new Document({
  styles: {
    default: { document: { run: { font: "Calibri", size: 22, color: "1A1A1A" } } },
    paragraphStyles: [
      {
        id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 40, bold: true, color: AZUL, font: "Calibri" },
        paragraph: { spacing: { before: 320, after: 160 } },
      },
      {
        id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 32, bold: true, color: AZUL, font: "Calibri" },
        paragraph: { spacing: { before: 260, after: 120 } },
      },
      {
        id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 26, bold: true, color: AZUL_CLARO, font: "Calibri" },
        paragraph: { spacing: { before: 200, after: 100 } },
      },
    ],
  },
  numbering: {
    config: [
      {
        reference: "bullets",
        levels: [
          { level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 460, hanging: 260 } } } },
          { level: 1, format: LevelFormat.BULLET, text: "\u25E6", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 920, hanging: 260 } } } },
        ],
      },
    ],
  },
  sections: [
    // ===== CAPA =====
    {
      properties: {},
      children: [
        new Paragraph({ spacing: { before: 2200 } }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "PLANO DE AÇÃO", bold: true, size: 56, color: AZUL })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120 }, children: [new TextRun({ text: "Demonstração ao Cliente: Como Construir um Agente de IA", size: 30, color: AZUL_CLARO, bold: true })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 200 }, children: [new TextRun({ text: "Aplicação das 8 etapas do guia ao caso Saturno-Calc / MYDAS", size: 24, color: CINZA })] }),
        new Paragraph({ spacing: { before: 1100 } }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Dimastec", bold: true, size: 36, color: AZUL_CLARO })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 80 }, children: [new TextRun({ text: "Apresentação para o CTO — Natanael Morais", size: 24, color: CINZA })] }),
        new Paragraph({ spacing: { before: 1200 } }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Sousa Lima Consultoria", size: 24, color: CINZA })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 80 }, children: [new TextRun({ text: "29 de agosto de 2026", size: 22, color: CINZA })] }),
      ],
    },
    // ===== CONTEÚDO =====
    {
      properties: {},
      children: [
        // Objetivo da demonstração
        new Paragraph({ children: [new TextRun({ text: "1. Objetivo da demonstração", bold: true, size: 32, color: AZUL })] }),
        new Paragraph({ spacing: { before: 120 } }),
        new Paragraph({
          children: [
            new TextRun({ text: "Demonstrar ao CTO da Dimastec, de forma prática, " }),
            new TextRun({ text: "como construir um agente de IA", bold: true }),
            new TextRun({ text: " a partir do guia " }),
            new TextRun({ text: "“Como Construir um Agente de IA”", italic: true }),
            new TextRun({ text: " — aplicando as 8 etapas do método a um " }),
            new TextRun({ text: "caso real do projeto", bold: true }),
            new TextRun({ text: ": o " }),
            new TextRun({ text: "assistente técnico do Saturno-Calc / MYDAS", bold: true }),
            new TextRun({ text: " (leitura de documentação, ADRs e código para apoiar a migração procedure → Java)." }),
          ],
        }),
        new Paragraph({ spacing: { before: 140 } }),
        new Paragraph({ children: [new TextRun({ text: "Resultado esperado da sessão:", bold: true, color: AZUL })] }),
        new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: "CTO vê um agente em funcionamento aplicado ao contexto deles, não um guia teórico." })] }),
        new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: "Valida o método das 8 etapas como padrão para os demais casos de uso da Dimastec." })] }),
        new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: "Fecha um próximo passo concreto (piloto do assistente técnico read-only)." })] }),

        new Paragraph({ children: [new PageBreak()] }),

        // Roteiro
        new Paragraph({ children: [new TextRun({ text: "2. Roteiro da demonstração — as 8 etapas", bold: true, size: 32, color: AZUL })] }),
        new Paragraph({ spacing: { before: 140 } }),

        // Tabela resumo
        (() => {
          const l = [1100, 2000, 2900, 3100];
          return new Table({
            width: { size: 1100 + 2000 + 2900 + 3100, type: WidthType.DXA },
            columnWidths: l,
            rows: [
              linhaCabecalho(["Etapa", "Do guia", "Aplicação ao caso Dimastec", "O que demonstrar na hora"], l),
              linha(["1. Propósito & Escopo", "Caso de uso, sucesso, restrições", "Assistente técnico read-only: tirar dúvidas do time sobre o Saturno/MYDAS sem tocar produção", "Definir 1 pergunta de negócio e o critério de sucesso"], l),
              linha(["2. System Prompt", "Papel, instruções, guardrails", "Persona “arquiteto sênior”; proibido consultar banco de produção; sempre citar fonte", "Mostrar o prompt com guardrails visíveis"], l),
              linha(["3. Escolher o LLM", "Custo, contexto, raciocínio", "Modelo com janela ampla (documentação densa); métricas de custo/latência", "Comparar 2 modelos no custo por 1M de tokens"], l),
              linha(["4. Ferramentas & Integrações", "MCP, APIs, funções", "Ler ADRs e bases do projeto; MCP para acessar conhecimento (RAG) sem escrever", "Demonstrar uma chamada MCP ao vivo"], l),
              linha(["5. Memória", "Vetorial, SQL, arquivos", "RAG sobre ADRs/políticas; histórico da conversa; sem dados biométricos", "Mostrar o retorno de um RAG citando fonte"], l),
              linha(["6. Orquestração", "Workflows, filas, erros", "Rota de pergunta → recupera contexto → responde; retry com backoff", "Mostrar fluxo e tratamento de erro"], l),
              linha(["7. Interface", "Chat, web, API", "Interface de chat para o time técnico; futura integração ao fluxo de suporte", "Demonstrar o chat interativo"], l),
              linha(["8. Testes & Evals", "Qualidade, latência, iteração", "Golden tests das respostas; métrica de fidelidade ao contexto", "Mostrar resultado de um eval de exemplo"], l),
            ],
          });
        })(),

        new Paragraph({ children: [new PageBreak()] }),

        // Preparação
        new Paragraph({ children: [new TextRun({ text: "3. Preparação antes da sessão", bold: true, size: 32, color: AZUL })] }),
        new Paragraph({ spacing: { before: 140 } }),

        (() => {
          const l = [2200, 4800, 2100];
          return new Table({
            width: { size: 2200 + 4800 + 2100, type: WidthType.DXA },
            columnWidths: l,
            rows: [
              linhaCabecalho(["Item", "Descrição", "Responsável"], l),
              linha(["Ambiente preparado", "Instância/demo do assistente com RAG carregada (ADRs, políticas, código do Saturno) — sobe via instalador guiado (npm run setup)", "Everton"], l),
              linha(["Cenário definido", "3 perguntas demonstrativas relevantes para o CTO (ex: “qual o padrão de ORM do piloto?”)", "Everton + Natanael"], l),
              linha(["Guardrails configurados", "Kit de limites: proibido escrever, proibido dados de produção, sempre citar fonte", "Everton"], l),
              linha(["Eval de exemplo", "1 golden test pronto mostrando respostas esperadas x obtidas", "Everton"], l),
              linha(["Plano B (fallback)", "Slides do guia + vídeo curto caso a demo ao vivo falhe", "Everton"], l),
            ],
          });
        })(),

        new Paragraph({ children: [new PageBreak()] }),

        // Timeline / agenda da sessão
        new Paragraph({ children: [new TextRun({ text: "4. Agenda da sessão de demonstração", bold: true, size: 32, color: AZUL })] }),
        new Paragraph({ spacing: { before: 140 } }),

        (() => {
          const l = [1500, 4700, 2900];
          return new Table({
            width: { size: 1500 + 4700 + 2900, type: WidthType.DXA },
            columnWidths: l,
            rows: [
              linhaCabecalho(["Tempo", "Bloco", "Objetivo"], l),
              linha(["10 min", "Contexto: o método das 8 etapas em 1 slide", "Nivelar o CTO na estrutura do guia"], l),
              linha(["25 min", "Demo ao vivo do assistente técnico", "Percorrer as 8 etapas com o caso Saturno/MYDAS"], l),
              linha(["10 min", "Governança e guardrails na prática", "Mostrar limites reais e a não-exposição de dados"], l),
              linha(["10 min", "Evals e como medir qualidade", "Mostrar um golden test e métrica de fidelidade"], l),
              linha(["5 min", "Próximos passos e piloto", "Acordar o piloto read-only do assistente técnico"], l),
            ],
          });
        })(),
        new Paragraph({ spacing: { before: 120 } }),
        new Paragraph({ children: [new TextRun({ text: "Duração total sugerida: 60 minutos.", bold: true, color: AZUL_CLARO })] }),

        new Paragraph({ children: [new PageBreak()] }),

        // Mensagens-chave / como o guia conecta com o projeto
        new Paragraph({ children: [new TextRun({ text: "5. Mensagens-chave para o CTO", bold: true, size: 32, color: AZUL })] }),
        new Paragraph({ spacing: { before: 140 } }),
        new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: "O guia não é teoria: é o ", bold: true }), new TextRun({ text: "mesmo fluxo que já aplicamos no Saturno-Calc", bold: true }), new TextRun({ text: " (propósito → LLM → ferramentas → memória → orquestração → evals)." })] }),
        new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: "A etapa 4 (MCP) e o Projeto Zero já estão em andamento: ", bold: true }), new TextRun({ text: "a Dimastec já usa Claude Code, Rovo e um servidor MCP interno", italic: true }), new TextRun({ text: " — a demo mostra como formalizar isso." })] }),
        new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: "Governança embutida: cada etapa respeita as políticas de ", bold: true }), new TextRun({ text: "ISO 27001 / LGPD / POL-IA-001", bold: true }), new TextRun({ text: " e a classificação de casos de uso (IA aplicada, sem dados biométricos em runtime)." })] }),
        new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: "Fechamento natural com o modelo de mentoria: ", bold: true }), new TextRun({ text: "esta demo é a porta de entrada para o piloto do assistente técnico do Mês 3.", italic: true })] }),

        new Paragraph({ children: [new PageBreak()] }),

        // Próximos passos pós-demo
        new Paragraph({ children: [new TextRun({ text: "6. Próximos passos após a demonstração", bold: true, size: 32, color: AZUL })] }),
        new Paragraph({ spacing: { before: 140 } }),

        (() => {
          const l = [2100, 4700, 2300];
          return new Table({
            width: { size: 2100 + 4700 + 2300, type: WidthType.DXA },
            columnWidths: l,
            rows: [
              linhaCabecalho(["Ação", "Detalhe", "Prazo"], l),
              linha(["Aprovar o piloto", "Assistente técnico read-only no escopo do Mês 3 da mentoria", "1 semana"], l),
              linha(["Definir fontes aprovadas", "Allowlist de documentação, ADRs, tickets sanitizados", "2 semanas"], l),
              linha(["Metrics", "Definir baseline de qualidade e fidelidade do assistente", "2 semanas"], l),
              linha(["Treinar multiplicadores", "Times de engenharia no método das 8 etapas", "Contínuo"], l),
            ],
          });
        })(),
        new Paragraph({ children: [new PageBreak()] }),

        // ===== 7. Passo a passo prático =====
        new Paragraph({ children: [new TextRun({ text: "7. Passo a passo prático — construindo o assistente com Claude Code", bold: true, size: 32, color: AZUL })] }),
        new Paragraph({ spacing: { before: 140 } }),
        new Paragraph({
          children: [
            new TextRun({ text: "Este é o roteiro de execução, na ordem, para levar o assistente técnico do Saturno-Calc / MYDAS do zero à produção — " }),
            new TextRun({ text: "usando o ferramental que a Dimastec já tem (Claude Code + servidor MCP interno)", bold: true }),
            new TextRun({ text: ". Cada etapa mostra o que fazer, como fazer com o Claude Code e como isso é feito aqui no assistente-os (a referência de implementação que a Sousa Lima mantém)." }),
          ],
        }),
        new Paragraph({ spacing: { before: 120 } }),

        // ---- Passo 0 ----
        new Paragraph({ children: [new TextRun({ text: "Passo 0 — Setup, escopo e barreiras de segurança", bold: true, color: AZUL_CLARO })] }),
        new Paragraph({ spacing: { before: 60 } }),
        new Paragraph({ children: [new TextRun({ text: "Antes de qualquer código: definir limites logo de cara, porque assistente técnico é ", }), new TextRun({ text: "read-only", bold: true }), new TextRun({ text: " e não pode tocar produção." })] }),
        new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: "Propósito (1 linha): " }), new TextRun({ text: "“Tirar dúvidas do time sobre o Saturno/MYDAS lendo documentação, ADRs e código — sem escrever e sem consultar banco de produção”", italic: true })] }),
        new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: "Critério de sucesso (" }), new TextRun({ text: "o que define “funcionou”", italic: true }), new TextRun({ text: "): resposta certa + cita a fonte (ADR/doc/código) de onde tirou." })] }),
        new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: "Guardrails mínimos (" }), new TextRun({ text: "kit de limites", bold: true }), new TextRun({ text: "): proibido escrever em repositório/bancos, proibido dados de produção, sempre citar fonte; classificar o caso como " }), new TextRun({ text: "IA aplicada (não-dados sensíveis)", italic: true }), new TextRun({ text: " — alinhado à POL-IA-001 e à classificação de casos de uso da Dimastec." })] }),
        new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: "Referência (assistente-os): " }), new TextRun({ text: "cada “alma” (soul) declara propósitos e permissões em config; o runtime aplica allowlist de tools e nega o resto por padrão (fail-closed).", italic: true })] }),

        new Paragraph({ spacing: { before: 160 } }),

        // ---- Passo 1 ----
        new Paragraph({ children: [new TextRun({ text: "Passo 1 — System Prompt (o comando que define o agente)", bold: true, color: AZUL_CLARO })] }),
        new Paragraph({ spacing: { before: 60 } }),
        new Paragraph({ children: [new TextRun({ text: "No Claude Code, isto é o arquivo de instruções do projeto/agente (ex: " }), new TextRun({ text: "AGENTS.md", italic: true }), new TextRun({ text: " ou o prompt do subagente). É ali que mora a " }), new TextRun({ text: "persona + regras", bold: true }), new TextRun({ text: "." })] }),
        new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: "Persona: " }), new TextRun({ text: "“arquiteto sênior de Java que conhece o Saturno/MYDAS e responde em português com fonte”", italic: true })] }),
        new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: "Instruções: explicar a migração procedure → Java, citar camadas/patterns do hub (ex: DAO, @Secured, route handler), responder só com base no material indexado." })] }),
        new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: "Guardrails em texto visível: " }), new TextRun({ text: "nunca escrever, nunca acessar produção, dizer “não sei” se o RAG não achar, citar sempre a fonte.", bold: true })] }),
        new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: "Referência (assistente-os): " }), new TextRun({ text: "o pool de prompts está versionado (CAMPO de prompts / prompt-garden) e a montagem é determinística — persona no início, sessão/RAG/histórico no fim.", italic: true })] }),

        new Paragraph({ spacing: { before: 160 } }),

        // ---- Passo 2 ----
        new Paragraph({ children: [new TextRun({ text: "Passo 2 — Escolher o modelo (LLM) com visão de custo", bold: true, color: AZUL_CLARO })] }),
        new Paragraph({ spacing: { before: 60 } }),
        new Paragraph({ children: [new TextRun({ text: "Documentação densa (ADR + código) pede " }), new TextRun({ text: "janela de contexto ampla", bold: true }), new TextRun({ text: " e bom raciocínio. Comparar 2–3 modelos antes de fixar." })] }),
        new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: "Critérios: custo por 1M de tokens (entrada/saída), janela de contexto, latência, qualidade em português técnico." })] }),
        new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: "No assistente-os, o roteador escolhe o modelo por tier e mede custo por chamada; no Claude Code, decide-se o modelo do agente e acompanha-se o custo do uso." })] }),
        new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: "Entregável: " }), new TextRun({ text: "tabela com 2 modelos (custo × contexto × nota), decisão registrada em 1 ADR.", bold: true })] }),

        new Paragraph({ spacing: { before: 160 } }),

        // ---- Passo 3 ----
        new Paragraph({ children: [new TextRun({ text: "Passo 3 — Ferramentas & Integrações (MCP)", bold: true, color: AZUL_CLARO })] }),
        new Paragraph({ spacing: { before: 60 } }),
        new Paragraph({ children: [new TextRun({ text: "A Dimastec já tem " }), new TextRun({ text: "servidor MCP interno", bold: true }), new TextRun({ text: " — este é o passo para conectá-lo. O agente ganha tools para " }), new TextRun({ text: "ler ADRs, repositórios e base de conhecimento", italic: true }), new TextRun({ text: " sem poder escrever." })] }),
        new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: "Expor via MCP: busca na base de conhecimento (RAG), leitura de ADR, leitura de código — todas " }), new TextRun({ text: "somente-leitura", bold: true }), new TextRun({ text: "." })] }),
        new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: "Referência (assistente-os): " }), new TextRun({ text: "o kernel expõe ferramentas MCP sobre stdio com classificação de risco L1/L2/L3; a “alma/soul” só enxerga as tools na sua allowlist. No Claude Code, as ferramentas MCP entram no mesmo arquivo de configuração do projeto.", italic: true })] }),
        new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: "Teste na hora: " }), new TextRun({ text: "uma chamada MCP ao vivo que busca um trecho de ADR e responde citando o arquivo.", bold: true })] }),

        new Paragraph({ spacing: { before: 160 } }),

        // ---- Passo 4 ----
        new Paragraph({ children: [new TextRun({ text: "Passo 4 — Memória (RAG + histórico)", bold: true, color: AZUL_CLARO })] }),
        new Paragraph({ spacing: { before: 60 } }),
        new Paragraph({ children: [new TextRun({ text: "O assistente precisa " }), new TextRun({ text: "lembrar do contexto do projeto", bold: true }), new TextRun({ text: " sem ter tudo no prompt a cada vez. Para isso, indexar ADRs, políticas e código em uma base vetorial e guardar o histórico da conversa." })] }),
        new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: "Indexar documentos aprovados (allowlist): ADRs do Saturno, políticas (ISO 27001/LGPD/POL-IA-001) e trechos de código sanitizados — sem dados de produção." })] }),
        new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: "Hispersistir o histórico por thread/sessão para conversas contínuas." })] }),
        new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: "Referência (assistente-os): " }), new TextRun({ text: "RAG com embeddings + re-rank multilíngue opcional; cada resposta cita a fonte no formato [doc · similaridade · data] com um score de confiança multi-sinal calculado a partir do RAG; abaixo do limiar, o agente responde “evidência insuficiente” em vez de inventar.", italic: true })] }),

        new Paragraph({ spacing: { before: 160 } }),

        // ---- Passo 5 ----
        new Paragraph({ children: [new TextRun({ text: "Passo 5 — Orquestração (o fluxo do agente)", bold: true, color: AZUL_CLARO })] }),
        new Paragraph({ spacing: { before: 60 } }),
        new Paragraph({ children: [new TextRun({ text: "Definir o caminho que o agente segue: " }), new TextRun({ text: "entende a pergunta → recupera contexto (RAG) → decide se precisa de ferramenta → responde", bold: true }), new TextRun({ text: " — com retry/tratamento de erro." })] }),
        new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: "Modos por complexidade: " }), new TextRun({ text: "pergunta curta → resposta rápida; pergunta com “passo a passo”/“análise” → fluxo mais profundo (fast/auto/pro como no assistente-os).", italic: true })] }),
        new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: "No Claude Code, o próprio agente já orquestra com tools; a decisão é " }), new TextRun({ text: "quando ele pode chamar ferramenta", bold: true }), new TextRun({ text: " e o que fazer em erro (limite de tentativas, timeout, dizer “não consegui”)." })] }),
        new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: "Referência (assistente-os): " }), new TextRun({ text: "grafo LangGraph retrieve→generate↷tools com limite de iterações, streaming por etapa e escalonamento quando o contexto é fraco.", italic: true })] }),

        new Paragraph({ spacing: { before: 160 } }),

        // ---- Passo 6 ----
        new Paragraph({ children: [new TextRun({ text: "Passo 6 — Interface (como o time vai usar)", bold: true, color: AZUL_CLARO })] }),
        new Paragraph({ spacing: { before: 60 } }),
        new Paragraph({ children: [new TextRun({ text: "Definir onde o assistente " }), new TextRun({ text: "aparece", bold: true }), new TextRun({ text: " para o time técnico. Começar simples." })] }),
        new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: "Fase 1: chat no terminal/IDE (Claude Code) sendo o próprio assistente com o prompt + MCP configurado." })] }),
        new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: "Fase 2: interface web de chat para o time, com histórico por usuário." })] }),
        new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: "Fase 3 (opcional): API para o fluxo de suporte existente." })] }),
        new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: "Referência (assistente-os): " }), new TextRun({ text: "chat via REST/WebSocket com streaming etapa-a-etapa e painel web — o CTO pode ver o grafo rodando ao vivo.", italic: true })] }),

        new Paragraph({ spacing: { before: 160 } }),

        // ---- Passo 7 ----
        new Paragraph({ children: [new TextRun({ text: "Passo 7 — Testes & Evals (qualidade mensurável)", bold: true, color: AZUL_CLARO })] }),
        new Paragraph({ spacing: { before: 60 } }),
        new Paragraph({ children: [new TextRun({ text: "Sem eval não há como provar que o assistente " }), new TextRun({ text: "melhora", bold: true }), new TextRun({ text: " ao longo do tempo. Criar um " }), new TextRun({ text: "golden set", bold: true }), new TextRun({ text: " de perguntas com respostas esperadas." })] }),
        new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: "Montar golden set real do Saturno: ex. “qual o padrão de DAO multi-tenant?” → espera-se citar o ADR/pattern do hub; “todo endpoint precisa de @Secured?” → sim, pelos rules." })] }),
        new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: "Medir recuperação: " }), new TextRun({ text: "hit@1 (o doc certo aparece em 1º?), MRR, recall@5", italic: true }), new TextRun({ text: " — fidelidade da resposta ao contexto (não alucinar) e taxa de recusa em perguntas adversariais/fora de escopo." })] }),
        new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: "Gate no CI: " }), new TextRun({ text: "uma pergunta que não atingir o piso (ex: hit@1 ≥ 0.7) bloqueia o release antes de piorar em produção.", bold: true })] }),
        new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: "Referência (assistente-os): " }), new TextRun({ text: "comando de avaliação de RAG com golden set, medindo hit@1/MRR/recall + taxa de recusa adversarial, com histórico de execuções registrado; sai com código de erro se o piso não for atingido. Já preparamos um golden set inicial com 23 casos a partir da documentação do hub — ponto de partida a expandir com o time.", italic: true })] }),

        new Paragraph({ spacing: { before: 200 } }),

        // Fechamento
        new Paragraph({ children: [new TextRun({ text: "Sequência-resumo (8 etapas em 7 movimentos)", bold: true, color: AZUL })] }),
        new Paragraph({ spacing: { before: 80 } }),
        new Paragraph({ children: [new TextRun({ text: "Escopo+guardrails → Prompt → Modelo → MCP → Memória → Orquestração → Interface → Evals. ", bold: true }), new TextRun({ text: "A ordem é pensada para o CTO ver valor rápido (MCP + RAG já respondem no dia 1) e segurança antes de escala (guardrails e evals desde o início). Cada etapa fecha com um " }), new TextRun({ text: "artefato mínimo", italic: true }), new TextRun({ text: ": ADR, prompt versionado, tabela de modelo, allowlist, golden set." })] }),
        new Paragraph({ spacing: { before: 120 } }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "— Fim do plano —", size: 20, color: CINZA, italics: true })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 80 }, children: [new TextRun({ text: "Sousa Lima Consultoria · Everton Lima · everton@sousalimaconsultoria.com.br", size: 20, color: CINZA })] }),
      ],
    },
  ],
});

Packer.toBuffer(doc).then((buf) => {
  const out = "/home/support/assistente-os/docs/dimastec/Plano-Demonstracao-Agente-IA-Dimastec-CTO.docx";
  fs.writeFileSync(out, buf);
  console.log("Documento gerado:", out, "-", buf.length, "bytes");
});
