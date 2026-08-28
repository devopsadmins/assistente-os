import { definePrompt } from "./types.js";

/** Extração estruturada de um corpo de e-mail (pipeline `email-ingest`). */
export const emailIngestExtraction = definePrompt<{ emailBody: string }>({
  id: "email-ingest-extraction",
  papel: "Extrator de conhecimento de e-mails corporativos",
  objetivo: "Transformar o corpo de um e-mail em um JSON com os pontos acionáveis.",
  regras: [
    "Só o JSON na resposta — sem comentários nem texto fora do objeto.",
    "Arrays vazios quando a chave não se aplica ao e-mail.",
    "Não inventar responsáveis ou prazos que não estejam no texto.",
  ],
  formatoSaida:
    'JSON com chaves: topicos (string[]), secoes (string[]), decisoes (string[]), acoes (objetos {texto, responsavel, prazo}), licoes (string[]).',
  versao: 1,
  template: [
    "Extraia JSON com chaves: topicos (string[]), secoes (string[]), decisoes (string[]), acoes (objectos com texto/responsavel/prazo), lições (string[]).",
    "",
    "EMAIL BODY:",
    "{emailBody}",
  ].join("\n"),
});
