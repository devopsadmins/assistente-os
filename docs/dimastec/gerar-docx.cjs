const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, ShadingType,
  AlignmentType, BorderStyle, PageBreak, LevelFormat, TabStopType,
} = require("docx");

const AZUL = "1F4E79";
const AZUL_CLARO = "2E74B5";
const CINZA = "595959";
const FUNDO_TITULO = "1F4E79";
const FUNDO_CABECALHO_TABELA = "2E74B5";
const BRANCO = "FFFFFF";

// Célula helper
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
      celula(t, { largura: larguras[i], negrito: true, cor: BRANCO, fundo: FUNDO_CABECALHO_TABELA })
    ),
  });
}

function linha(textos, larguras, centralizado = false) {
  return new TableRow({
    children: textos.map((t, i) => celula(t, { largura: larguras[i], centralizado })),
  });
}

function tabelaLarguras(...w) {
  return w;
}

const megas = new Document({
  styles: {
    default: {
      document: { run: { font: "Calibri", size: 22, color: "1A1A1A" } },
    },
    paragraphStyles: [
      {
        id: "Heading1",
        name: "Heading 1",
        basedOn: "Normal",
        next: "Normal",
        quickFormat: true,
        run: { size: 40, bold: true, color: AZUL, font: "Calibri" },
        paragraph: { spacing: { before: 320, after: 160 } },
      },
      {
        id: "Heading2",
        name: "Heading 2",
        basedOn: "Normal",
        next: "Normal",
        quickFormat: true,
        run: { size: 32, bold: true, color: AZUL, font: "Calibri" },
        paragraph: { spacing: { before: 260, after: 120 } },
      },
      {
        id: "Heading3",
        name: "Heading 3",
        basedOn: "Normal",
        next: "Normal",
        quickFormat: true,
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
          {
            level: 0, format: LevelFormat.BULLET, text: "\u2022",
            alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 460, hanging: 260 } } },
          },
          {
            level: 1, format: LevelFormat.BULLET, text: "\u25E6",
            alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 920, hanging: 260 } } },
          },
        ],
      },
    ],
  },
  sections: [
    // ============ CAPA ============
    {
      properties: {},
      children: [
        new Paragraph({ spacing: { before: 2400 } }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: "PROPOSTA DE MENTORIA IA-FIRST", bold: true, size: 56, color: AZUL })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 200 },
          children: [new TextRun({ text: "Transformação tecnológica e governada de Inteligência Artificial", size: 28, color: CINZA })],
        }),
        new Paragraph({ spacing: { before: 1200 } }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: "Dimastec", bold: true, size: 40, color: AZUL_CLARO })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 100 },
          children: [new TextRun({ text: "Apresentação para o CTO — Natanael Morais", size: 24, color: CINZA })],
        }),
        new Paragraph({ spacing: { before: 1400 } }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: "Sousa Lima Consultoria", size: 24, color: CINZA })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 100 },
          children: [new TextRun({ text: "29 de agosto de 2026", size: 22, color: CINZA })],
        }),
      ],
    },
    // ============ CONTEÚDO ============
    {
      properties: {},
      children: [
        // --- Sumário/Contexto ---
        new Paragraph({ children: [new TextRun({ text: "1. Contexto e entendimento", bold: true, size: 32, color: AZUL })] }),
        new Paragraph({ spacing: { before: 120 } }),
        new Paragraph({
          children: [
            new TextRun({ text: "A Dimastec está em um momento estratégico: modernização do legado, adoção de IA e conformidade com ISO 27001/LGPD caminham juntas. O projeto " }),
            new TextRun({ text: "Saturno-Calc", bold: true }),
            new TextRun({ text: " (novo microsserviço de cálculo de horas) e a evolução do " }),
            new TextRun({ text: "Projeto Zero", bold: true }),
            new TextRun({ text: " consolidam a decisão de migração orientada por IA, documentada por ADRs e alinhada às políticas internas de segurança da informação e privacidade." }),
          ],
        }),
        new Paragraph({ spacing: { before: 160 } }),
        new Paragraph({
          children: [
            new TextRun({ text: "Já existe maturidade no processo: " }),
            new TextRun({ text: "política formal de IA, ~10 Risk Assessments por mês em atividade, e uma primeira rodada de execução do Claude que gerou Data Model Spec (18 migrações, 72 gaps), ADR-01 e documento de conformidade", italic: true }),
            new TextRun({ text: ". O que falta não é começar do zero — é " }),
            new TextRun({ text: "endurecer, formalizar e deixar o time capaz de repetir o processo", bold: true }),
            new TextRun({ text: " sem depender de um parceiro externo." }),
          ],
        }),
        new Paragraph({ spacing: { before: 160 } }),
        new Paragraph({
          bullet: { level: 0 },
          children: [new TextRun({ text: "Contrato PDTI: 6 meses, iniciado em 03/08/2026.", bold: true })],
        }),
        new Paragraph({
          bullet: { level: 0 },
          children: [new TextRun({ text: "Jornada IA-first: Saturno-Calc como microsserviço, não fusão do código legado." })],
        }),
        new Paragraph({
          bullet: { level: 0 },
          children: [new TextRun({ text: "Projeto Zero unificado: framework de IA + políticas ISO 27001/LGPD." })],
        }),
        new Paragraph({
          bullet: { level: 0 },
          children: [new TextRun({ text: "Instrumentos já validados: ADRs, questionário de 180 perguntas, multitenancy PostgreSQL por esquema." })],
        }),

        new Paragraph({ children: [new PageBreak()] }),

        // --- Por que mentoria ---
        new Paragraph({ children: [new TextRun({ text: "2. Por que uma mentoria e não uma fábrica de código", bold: true, size: 32, color: AZUL })] }),
        new Paragraph({ spacing: { before: 120 } }),
        new Paragraph({
          children: [
            new TextRun({ text: "O objetivo é deixar a Dimastec dona do processo. A consultoria não é uma " }),
            new TextRun({ text: "fábrica externa de código", bold: true }),
            new TextRun({ text: " nem um " }),
            new TextRun({ text: "projeto de agentes", bold: true }),
            new TextRun({ text: ". É uma " }),
            new TextRun({ text: "disciplina de transformação", bold: true }),
            new TextRun({ text: ": diagnosticar, escolher, formar padrões, testar hipóteses e treinar multiplicadores internos." }),
          ],
        }),
        new Paragraph({
          spacing: { before: 140 },
          children: [new TextRun({ text: "Os três ativos que a Dimastec leva ao final:", bold: true, color: AZUL })],
        }),
        new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: "Um " }), new TextRun({ text: "padrão técnico repetível", bold: true }), new TextRun({ text: " (playbook procedure → Java/Spring, templates, ADRs)." })] }),
        new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: "Uma " }), new TextRun({ text: "disciplina de decisão baseada em evidência", bold: true }), new TextRun({ text: " (checkpoints, métricas, avaliação de riscos)." })] }),
        new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: "Um " }), new TextRun({ text: "time capaz de expandir IA com limites claros", bold: true }), new TextRun({ text: " (classificação de casos de uso, governança)." })] }),

        new Paragraph({ children: [new PageBreak()] }),

        // --- Modelo / Trilhas ---
        new Paragraph({ children: [new TextRun({ text: "3. Modelo de mentoria: três trilhas, uma mudança por vez", bold: true, size: 32, color: AZUL })] }),
        new Paragraph({ spacing: { before: 120 } }),
        new Paragraph({
          children: [new TextRun({ text: "O programa mantém três trilhas visíveis, mas executa " }),
            new TextRun({ text: "apenas uma intervenção de mudança por vez", bold: true }),
            new TextRun({ text: ". O MYDAS é a trilha crítica de engenharia; a governança é o guardrail permanente; a IA aplicada entra como piloto controlado." })],
        }),
        new Paragraph({ spacing: { before: 140 } }),

        (() => {
          const larguras = tabelaLarguras(2400, 3600, 3100);
          const largTotal = 2400 + 3600 + 3100;
          return new Table({
            width: { size: largTotal, type: WidthType.DXA },
            columnWidths: larguras,
            rows: [
              linhaCabecalho(["Trilha", "Pergunta central", "Saída de cada ciclo"], larguras),
              linha(["Fluxo e modernização", "Onde o trabalho trava e qual procedure merece ser migrada primeiro?", "Hipótese testada, baseline, ADR e template reutilizável"], larguras),
              linha(["Governança e evidências", "Que risco existe, quem decide e qual artefato prova o controle?", "Gap fechado, exceção datada ou risco aceito pelo owner"], larguras),
              linha(["IA aplicada", "Que tarefa humana pode ser assistida sem ampliar risco indevidamente?", "Caso de uso limitado, avaliação, aprovação e decisão de expandir"], larguras),
            ],
          });
        })(),

        new Paragraph({ spacing: { before: 160 } }),
        new Paragraph({ children: [new TextRun({ text: "Ponto crítico do escopo", bold: true, color: AZUL_CLARO })] }),
        new Paragraph({
          bullet: { level: 0 },
          children: [
            new TextRun({ text: "O repositório de padrões " }),
            new TextRun({ text: "projeto0", italic: true }),
            new TextRun({ text: " não pode ser confundido com os produtos em produção (MYDAS, DT Faceum, Hubla, PCPT). A classificação " }),
            new TextRun({ text: "Core", italic: true }),
            new TextRun({ text: " de um servidor de padrões não se estende automaticamente a fluxos que processam dados biométricos ou de clientes." }),
          ],
        }),
        new Paragraph({
          bullet: { level: 0 },
          children: [
            new TextRun({ text: "Abrir um " }),
            new TextRun({ text: "registro de avaliação por combinação sistema + caso de uso + dado + efeito", bold: true }),
            new TextRun({ text: ", em vez de uma única declaração corporativa de conformidade." }),
          ],
        }),

        new Paragraph({ children: [new PageBreak()] }),

        // --- Limites de papel ---
        new Paragraph({ children: [new TextRun({ text: "4. Papéis e limites — o que a consultoria faz e o que não assume", bold: true, size: 32, color: AZUL })] }),
        new Paragraph({ spacing: { before: 120 } }),
        new Paragraph({
          children: [new TextRun({ text: "O papel da consultoria é de " }),
            new TextRun({ text: "mentor de transformação IA-first e qualidade de engenharia", bold: true }),
            new TextRun({ text: ": estrutura a descoberta, impõe critérios de decisão, desafia hipóteses, facilita ritos e avalia evidências. A equipe da Dimastec permanece dona da arquitetura, do código, das credenciais, da operação, do produto e da aprovação de riscos." })],
        }),
        new Paragraph({ spacing: { before: 140 } }),

        (() => {
          const larguras = tabelaLarguras(3100, 3100, 2900);
          return new Table({
            width: { size: 3100 + 3100 + 2900, type: WidthType.DXA },
            columnWidths: larguras,
            rows: [
              linhaCabecalho(["Você (mentoria) faz", "A Dimastec faz", "A consultoria não assume"], larguras),
              linha(["Facilita VSM, workshops de risco e priorização", "Fornece dados, responsáveis, ambiente e decisão de prioridade", "Desenvolver ou operar o produto em produção no lugar da equipe"], larguras),
              linha(["Define critérios de aceite do piloto proc → Java", "Implementa, testa, faz deploy e corrige o código", "Aprovar release, acessar credenciais ou ter poderes permanentes"], larguras),
              linha(["Revisa ADRs, decisões, planos de teste e evidências", "Mantém evidências, aprova exceções e executa controles", "Emitir certificação, parecer jurídico ou atestar conformidade"], larguras),
              linha(["Cria o método de adoção de IA e treina multiplicadores", "Nomeia sponsor, CTO, Tech Lead, DPO, segurança e owners", "Tornar-se dono dos agentes, RAGs, dados ou KPIs"], larguras),
            ],
          });
        })(),

        new Paragraph({ children: [new PageBreak()] }),

        // --- Cadência ---
        new Paragraph({ children: [new TextRun({ text: "5. Cadência semanal e mensal", bold: true, size: 32, color: AZUL })] }),
        new Paragraph({ spacing: { before: 140 } }),

        (() => {
          const larguras = tabelaLarguras(2200, 2700, 1200, 3000);
          return new Table({
            width: { size: 2200 + 2700 + 1200 + 3000, type: WidthType.DXA },
            columnWidths: larguras,
            rows: [
              linhaCabecalho(["Ritual", "Participantes", "Duração", "Resultado obrigatório"], larguras),
              linha(["Oficina de fluxo", "CTO, Tech Lead, dono do processo, QA, mentor", "90 min/sem", "Mapa do fluxo, bloqueio, hipótese e próximo experimento"], larguras),
              linha(["Clínica de arquitetura e IA", "Tech Lead, engenheiros, segurança/privacidade, mentor", "60 min/sem", "ADR/decisão, critérios de teste, limites de dados"], larguras),
              linha(["Checkpoint executivo", "Sponsor, CTO, produto, segurança/DPO, mentor", "45 min/sem", "Decisões pendentes resolvidas e prioridades protegidas"], larguras),
              linha(["Steering mensal", "Diretoria e owners", "90 min/mês", "Métricas, entregáveis aceitos, exceções e próximo marco"], larguras),
            ],
          });
        })(),
        new Paragraph({ spacing: { before: 140 } }),
        new Paragraph({
          children: [new TextRun({ text: "O checkpoint não é reunião de status. ", bold: true }),
            new TextRun({ text: "Cada encontro encerra com decisão, responsável, prazo, evidência esperada e condição de reversão. Sem decisão, registra-se o bloqueio e quem pode removê-lo." })],
        }),

        new Paragraph({ children: [new PageBreak()] }),

        // --- Roadmap 6 meses ---
        new Paragraph({ children: [new TextRun({ text: "6. Roteiro de seis meses", bold: true, size: 32, color: AZUL })] }),
        new Paragraph({ spacing: { before: 140 } }),

        (() => {
          const larguras = tabelaLarguras(1600, 4200, 3300);
          return new Table({
            width: { size: 1600 + 4200 + 3300, type: WidthType.DXA },
            columnWidths: larguras,
            rows: [
              linhaCabecalho(["Fase", "Foco", "Entregáveis da mentoria"], larguras),
              linha(["Mês 1", "Diagnóstico que produz decisão (VSM, baseline, inventário de IA, seleção da procedure-piloto)", "Mapa VSM, matriz de sistemas e dados, RACI mínimo"], larguras),
              linha(["Mês 2", "Piloto completo (golden tests, Java/Spring + jOOQ, integração PostgreSQL, rollback)", "ADR do piloto, definição de pronto, plano de rollback, pacote de evidências"], larguras),
              linha(["Mês 3", "Assistente técnico read-only e avaliado (fontes aprovadas, kill switch)", "Carta do caso de uso, allowlist de fontes, métricas de qualidade"], larguras),
              linha(["Meses 4-5", "Escalar o padrão, não o volume de ferramentas; fechar lacunas de governança", "Playbook proc → Java, dashboard de fluxo, plano de remediação"], larguras),
              linha(["Mês 6", "Readiness e transferência de capacidade (ritos sobrevivem sem a consultoria)", "Scorecard antes/depois, roadmap de 90 dias, relatório de capacidade"], larguras),
            ],
          });
        })(),

        new Paragraph({ children: [new PageBreak()] }),

        // --- Métricas ---
        new Paragraph({ children: [new TextRun({ text: "7. Métricas que importam", bold: true, size: 32, color: AZUL })] }),
        new Paragraph({ spacing: { before: 120 } }),
        new Paragraph({
          children: [new TextRun({ text: "Não definimos metas numéricas antes de coletar o baseline. O primeiro mês serve para medir; a evolução é pactuada depois. A diretoria precisa de poucas métricas comparáveis — não de um painel de atividade." })],
        }),
        new Paragraph({ spacing: { before: 140 } }),

        (() => {
          const larguras = tabelaLarguras(2300, 3350, 3450);
          return new Table({
            width: { size: 2300 + 3350 + 3450, type: WidthType.DXA },
            columnWidths: larguras,
            rows: [
              linhaCabecalho(["Dimensão", "Métrica de baseline", "Indicador de avanço"], larguras),
              linha(["Capacidade de engenharia", "% de tempo em suporte L3, bugs, retrabalho e legado", "Menor carga reativa, maior previsibilidade"], larguras),
              linha(["Modernização", "Lead time por procedure, cobertura de golden/contract tests", "Migração repetível sem mudança funcional"], larguras),
              linha(["Qualidade", "Falhas escapadas, rollback, reabertura de chamado", "Menos regressão, detecção mais cedo"], larguras),
              linha(["IA assistida", "Taxa de resposta útil com fonte, taxa de correção humana", "Expansão só quando qualidade supera o baseline humano"], larguras),
              linha(["Governança", "% de controles com evidência, exceções vencidas", "Menos controle sem prova, menos risco sem owner"], larguras),
              linha(["Negócio", "Tempo de resposta a clientes, capacidade liberada", "Ganho que o sponsor reconhece"], larguras),
            ],
          });
        })(),

        new Paragraph({ children: [new PageBreak()] }),

        // --- Decisões e próximos passos ---
        new Paragraph({ children: [new TextRun({ text: "8. Primeiras decisões a conduzir", bold: true, size: 32, color: AZUL })] }),
        new Paragraph({ spacing: { before: 140 } }),

        (() => {
          const larguras = tabelaLarguras(3200, 2300, 3600);
          return new Table({
            width: { size: 3200 + 2300 + 3600, type: WidthType.DXA },
            columnWidths: larguras,
            rows: [
              linhaCabecalho(["Decisão", "Dono", "Critério para encerrar"], larguras),
              linha(["Qual procedure entra no piloto?", "CTO + Tech Lead", "Impacto/complexidade confirmados e baseline disponível"], larguras),
              linha(["Limite do assistente técnico", "CTO + Segurança + DPO", "Fontes, dados proibidos e kill switch documentados"], larguras),
              linha(["Produtos que requerem reclassificação AI-1+", "Arquitetura + DPO", "Registro por sistema, não por empresa inteira"], larguras),
              linha(["Lacunas do ciclo de 90 dias", "Sponsor + owners", "Owner, prazo, evidência e consequência de atraso"], larguras),
              linha(["Capacidade a transferir", "CTO + mentor", "Ritos operados pela Dimastec por um ciclo"], larguras),
            ],
          });
        })(),

        new Paragraph({ spacing: { before: 200 } }),
        new Paragraph({ children: [new TextRun({ text: "9. Veredito e valor entregue", bold: true, size: 32, color: AZUL })] }),
        new Paragraph({ spacing: { before: 120 } }),
        new Paragraph({
          children: [new TextRun({ text: "O plano da Dimastec é " }),
            new TextRun({ text: "mais maduro do que a iniciativa típica de “implantação de IA”", italic: true }),
            new TextRun({ text: ": parte de um gargalo de engenharia real, reconhece governança e prevê evidências. A melhoria necessária é reduzir a ambiguidade entre o repositório de padrões, os produtos em produção e os futuros casos de IA." })],
        }),
        new Paragraph({ spacing: { before: 140 } }),
        new Paragraph({
          children: [new TextRun({ text: "Ao final do programa, a Dimastec terá formado capacidade interna com três ativos: um " }),
            new TextRun({ text: "padrão técnico repetível", bold: true }),
            new TextRun({ text: ", uma " }),
            new TextRun({ text: "disciplina de decisão baseada em evidência", bold: true }),
            new TextRun({ text: " e um " }),
            new TextRun({ text: "time capaz de expandir IA com limites claros", bold: true }),
            new TextRun({ text: " — mais valioso e sustentável do que a implementação de qualquer ferramenta específica." })],
        }),
        new Paragraph({ spacing: { before: 220 } }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: "— Fim da apresentação —", size: 20, color: CINZA, italics: true })],
        }),
        new Paragraph({ spacing: { before: 80 } }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: "Sousa Lima Consultoria · Everton Lima · everton@sousalimaconsultoria.com.br", size: 20, color: CINZA })],
        }),
      ],
    },
  ],
});

Packer.toBuffer(megas).then((buf) => {
  const out = "/home/support/assistente-os/docs/dimastec/Proposta-Mentoria-IA-Dimastec-CTO.docx";
  fs.writeFileSync(out, buf);
  console.log("Documento gerado:", out, "-", buf.length, "bytes");
});
