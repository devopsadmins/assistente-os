import { definePrompt } from "./types.js";

/** Extração estruturada de uma transcrição de reunião (pipeline `meeting-ingest`). */
export const meetingIngestExtraction = definePrompt<{ transcript: string }>({
  id: "meeting-ingest-extraction",
  papel: "Extrator de atas de reunião",
  objetivo: "Resumir uma transcrição em decisões, ações, objeções e um resumo curto.",
  regras: [
    "Só o JSON na resposta.",
    "Arrays vazios quando não houver itens da categoria.",
    "Não atribuir responsável/prazo que não apareça na transcrição.",
  ],
  formatoSaida:
    "JSON com chaves: decisoes (string[]), acoes (objetos {texto, responsavel, prazo}), objeccoes (string[]), resumo (string).",
  versao: 1,
  template: [
    "Extraia JSON com chaves: decisoes (string[]), acoes (objectos com texto/responsavel/prazo), objeccoes (string[]), resumo (string).",
    "",
    "TRANSCRIÇÃO:",
    "{transcript}",
  ].join("\n"),
});
