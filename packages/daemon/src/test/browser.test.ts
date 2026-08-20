import { test } from "node:test";
import assert from "node:assert/strict";
import { domTableToData, tableDataToMarkdown, activePageCount } from "../tools/browser.js";

test("browser: domTableToData converte array raw em TableData[]", () => {
  const raw = [
    {
      headers: ["Nome", "Idade", "Cidade"],
      cells: [
        ["Alice", "30", "São Paulo"],
        ["Bob", "25", "Rio de Janeiro"],
      ],
    },
  ];
  const result = domTableToData(raw);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0]!.headers, ["Nome", "Idade", "Cidade"]);
  assert.equal(result[0]!.rows.length, 2);
  assert.deepEqual(result[0]!.rows[0], { Nome: "Alice", Idade: "30", Cidade: "São Paulo" });
  assert.deepEqual(result[0]!.rows[1], { Nome: "Bob", Idade: "25", Cidade: "Rio de Janeiro" });
});

test("browser: domTableToData trata headers > cells gracefully", () => {
  const raw = [
    {
      headers: ["A", "B", "C"],
      cells: [["1", "2"]],
    },
  ];
  const result = domTableToData(raw);
  assert.equal(result[0]!.rows.length, 1);
  assert.deepEqual(result[0]!.rows[0], { A: "1", B: "2", C: "" });
});

test("browser: tableDataToMarkdown gera Markdown válido", () => {
  const tables = [
    {
      headers: ["Item", "Preço"],
      rows: [
        { Item: "Café", Preço: "R$ 5" },
        { Item: "Bolo", Preço: "R$ 12" },
      ],
    },
  ];
  const md = tableDataToMarkdown(tables);
  assert.ok(md.includes("| Item | Preço |"));
  assert.ok(md.includes("| --- | --- |"));
  assert.ok(md.includes("| Café | R$ 5 |"));
  assert.ok(md.includes("| Bolo | R$ 12 |"));
});

test("browser: tableDataToMarkdown retorna string vazia para array vazio", () => {
  assert.equal(tableDataToMarkdown([]), "");
});

test("browser: activePageCount retorna 0 quando nenhum browser foi iniciado", () => {
  // O engine é singleton — sem init, não há páginas
  assert.equal(typeof activePageCount(), "number");
});

test("browser: domTableToData com múltiplas tabelas", () => {
  const raw = [
    { headers: ["X"], cells: [["1"], ["2"]] },
    { headers: ["Y", "Z"], cells: [["a", "b"]] },
  ];
  const result = domTableToData(raw);
  assert.equal(result.length, 2);
  assert.equal(result[0]!.rows.length, 2);
  assert.equal(result[1]!.rows.length, 1);
  assert.deepEqual(result[1]!.rows[0], { Y: "a", Z: "b" });
});

test("browser: tableDataToMarkdown com múltiplas tabelas separadas por blank line", () => {
  const tables = [
    { headers: ["A"], rows: [{ A: "1" }] },
    { headers: ["B"], rows: [{ B: "2" }] },
  ];
  const md = tableDataToMarkdown(tables);
  assert.ok(md.includes("\n\n"));
  assert.ok(md.includes("| A |"));
  assert.ok(md.includes("| B |"));
});
