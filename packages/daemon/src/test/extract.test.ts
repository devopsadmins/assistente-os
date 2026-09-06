/**
 * FM1: extração de texto de PDF/DOCX/XLSX no upload self-service.
 * Testes puros (sem daemon/DB) — constroem as fixtures em memória.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";
import { extractDocumentText, writeKnowledgeSidecar, DOC_EXT_RE } from "../extract.js";

// Fixtures ficam na árvore de fonte (o tsc não copia .pdf para dist/): a partir
// de dist/test/ subimos dois níveis até packages/daemon/ e entramos em src/test/.
const FIXTURES = fileURLToPath(new URL("../../src/test/fixtures/", import.meta.url));

// ---------- fixture builders ----------

/** PDF mínimo válido com um único texto, com xref de offsets calculados. */
function makePdf(text: string): Buffer {
  const header = "%PDF-1.4\n";
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    null, // 5: content stream, montado abaixo
  ];
  const stream = text.length
    ? `BT /F1 18 Tf 40 720 Td (${text.replace(/([()\\])/g, "\\$1")}) Tj ET`
    : "";
  objs[4] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;

  let body = "";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets[i] = header.length + body.length;
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });

  const xrefStart = header.length + body.length;
  let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${String(off).padStart(10, "0")} 00000 n \n`;
  const trailer = `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return Buffer.from(header + body + xref + trailer, "latin1");
}

function makeDocx(paragraphs: string[]): Buffer {
  const zip = new AdmZip();
  zip.addFile(
    "[Content_Types].xml",
    Buffer.from(
      `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    ),
  );
  zip.addFile(
    "_rels/.rels",
    Buffer.from(
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    ),
  );
  const paras = paragraphs
    .map((p) => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`)
    .join("");
  zip.addFile(
    "word/document.xml",
    Buffer.from(
      `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
        `<w:body>${paras}</w:body></w:document>`,
    ),
  );
  return zip.toBuffer();
}

function makeXlsx(sheets: { name: string; rows: string[][] }[]): Buffer {
  const zip = new AdmZip();
  const shared: string[] = [];
  const sidx = (v: string) => {
    let i = shared.indexOf(v);
    if (i < 0) {
      i = shared.length;
      shared.push(v);
    }
    return i;
  };
  const sheetXml = sheets.map((s) => {
    const rows = s.rows
      .map((row, r) => {
        const cells = row
          .map((val, c) => {
            const ref = `${String.fromCharCode(65 + c)}${r + 1}`;
            return `<c r="${ref}" t="s"><v>${sidx(val)}</v></c>`;
          })
          .join("");
        return `<row r="${r + 1}">${cells}</row>`;
      })
      .join("");
    return `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
  });

  zip.addFile(
    "[Content_Types].xml",
    Buffer.from(
      `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>` +
        sheets
          .map(
            (_s, i) =>
              `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
          )
          .join("") +
        `</Types>`,
    ),
  );
  zip.addFile(
    "_rels/.rels",
    Buffer.from(
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
  );
  zip.addFile(
    "xl/workbook.xml",
    Buffer.from(
      `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
        sheets.map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
        `</sheets></workbook>`,
    ),
  );
  zip.addFile(
    "xl/sharedStrings.xml",
    Buffer.from(
      `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">` +
        shared.map((v) => `<si><t xml:space="preserve">${v}</t></si>`).join("") +
        `</sst>`,
    ),
  );
  sheetXml.forEach((xml, i) => zip.addFile(`xl/worksheets/sheet${i + 1}.xml`, Buffer.from(xml)));
  return zip.toBuffer();
}

// ---------- tests ----------

let dir: string;
function tmp(name: string, buf: Buffer): string {
  dir ??= mkdtempSync(join(tmpdir(), "aos-extract-"));
  const p = join(dir, name);
  writeFileSync(p, buf);
  return p;
}
after(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test("DOC_EXT_RE casa pdf/docx/xlsx e ignora o resto", () => {
  for (const ok of ["a.pdf", "b.DOCX", "c.Xlsx", "path/to/d.pdf"]) assert.ok(DOC_EXT_RE.test(ok), ok);
  for (const no of ["a.md", "b.txt", "c.png", "d.pptx", "e.doc"]) assert.ok(!DOC_EXT_RE.test(no), no);
});

test("extractDocumentText: PDF com texto", async () => {
  const r = await extractDocumentText(join(FIXTURES, "contrato.pdf"));
  assert.equal(r.ok, true, r.ok ? "" : (r as { reason: string }).reason);
  assert.match((r as { text: string }).text, /Contrato de presta/i);
});

test("extractDocumentText: PDF sem texto extraível → ok:false com motivo", async () => {
  // makePdf("") produz um PDF válido mas sem run de texto; o pdf.js antigo do
  // pdf-parse ora devolve texto vazio, ora rejeita o xref — os dois casos são
  // "não indexável", só o texto do motivo varia.
  const p = tmp("scan.pdf", makePdf(""));
  const r = await extractDocumentText(p);
  assert.equal(r.ok, false);
  assert.ok(typeof (r as { reason: string }).reason === "string" && (r as { reason: string }).reason.length > 0);
});

test("extractDocumentText: PDF corrompido → ok:false, não lança", async () => {
  const p = tmp("corrompido.pdf", Buffer.from("%PDF-1.4 isto nao e um pdf de verdade"));
  const r = await extractDocumentText(p);
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /ileg[íi]vel/i);
});

test("extractDocumentText: DOCX preserva parágrafos", async () => {
  const p = tmp("ata.docx", makeDocx(["Primeira linha da ata.", "Segunda linha com decisão."]));
  const r = await extractDocumentText(p);
  assert.equal(r.ok, true);
  const text = (r as { text: string }).text;
  assert.match(text, /Primeira linha da ata\./);
  assert.match(text, /Segunda linha com decisão\./);
  assert.ok(text.indexOf("Primeira") < text.indexOf("Segunda"));
});

test("extractDocumentText: XLSX rotula planilha e junta células", async () => {
  const p = tmp("planilha.xlsx", makeXlsx([
    { name: "Vendas", rows: [["Produto", "Qtd"], ["Cadeira", "12"]] },
  ]));
  const r = await extractDocumentText(p);
  assert.equal(r.ok, true);
  const text = (r as { text: string }).text;
  assert.match(text, /##\s+Vendas/);
  assert.match(text, /Produto \| Qtd/);
  assert.match(text, /Cadeira \| 12/);
});

test("extractDocumentText: extensão não suportada → ok:false", async () => {
  const p = tmp("imagem.png", Buffer.from("not a document"));
  const r = await extractDocumentText(p);
  assert.equal(r.ok, false);
});

test("writeKnowledgeSidecar: grava <arquivo>.md com cabeçalho e texto", () => {
  const src = tmp("relatorio.pdf", Buffer.from("x"));
  const sidecar = writeKnowledgeSidecar(src, "corpo do relatório\ncom duas linhas");
  assert.equal(sidecar, src + ".md");
  assert.ok(existsSync(sidecar));
  const md = readFileSync(sidecar, "utf8");
  assert.match(md, /^# relatorio\.pdf/m);
  assert.match(md, /extraíd[oa] automaticamente/i);
  assert.match(md, /corpo do relatório/);
});
