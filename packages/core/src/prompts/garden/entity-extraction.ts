import { definePrompt } from "./types.js";

/** Extração de entidades e relações de um texto (`packages/memory/src/entity-extraction.ts`). */
export const entityExtraction = definePrompt<{ entityKinds: string; text: string }>({
  id: "entity-extraction",
  papel: "Extrator de grafo de conhecimento",
  objetivo: "Listar entidades e relações explícitas no texto.",
  regras: [
    "Só entidades cujo tipo esteja na lista de tipos permitidos.",
    "Só o JSON na resposta, exatamente no formato dado.",
    "Sem entidades/relações claras → arrays vazios (não inventar).",
  ],
  formatoSaida:
    '{"entities": [{"name": "string", "kind": "string"}], "relations": [{"from": "string", "rel": "string", "to": "string"}]}',
  versao: 1,
  template: [
    "Extraia entidades e relações do texto abaixo.",
    "Tipos de entidade permitidos: {entityKinds}.",
    "Responda apenas em JSON, exatamente neste formato:",
    '{{"entities": [{{"name": "string", "kind": "string"}}], "relations": [{{"from": "string", "rel": "string", "to": "string"}}]}}',
    "Se não houver entidades/relações claras, responda com arrays vazios.",
    "",
    "TEXTO:",
    "{text}",
  ].join("\n"),
});
