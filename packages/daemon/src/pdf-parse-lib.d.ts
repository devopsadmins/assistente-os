// pdf-parse não publica tipos e o entrypoint tipável (@types/pdf-parse) aponta
// para o index.js — que não usamos (bloco de debug quebra sob ESM). Tipagem
// mínima do módulo interno que importamos de fato.
declare module "pdf-parse/lib/pdf-parse.js" {
  interface PdfParseResult {
    text: string;
    numpages: number;
    numrender: number;
    info: unknown;
    metadata: unknown;
    version: string;
  }
  function pdfParse(dataBuffer: Buffer, options?: Record<string, unknown>): Promise<PdfParseResult>;
  export default pdfParse;
}
