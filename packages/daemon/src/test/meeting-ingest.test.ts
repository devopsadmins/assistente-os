import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { meetingIngestPipeline } from "../pipelines/meeting-ingest.js";

const SAMPLE_VTT = `WEBVTT

1
00:00:01,000 --> 00:00:04,000
Bem-vindos à reunião de sprint.

2
00:00:05,000 --> 00:00:09,000
Decidimos adiar o lançamento para a próxima semana.
`;

const SAMPLE_SRT = `1
00:00:01,000 --> 00:00:04,000
Reunião de alinhamento com o cliente.

2
00:00:05,000 --> 00:00:09,000
Ação: enviar proposta. Responsável: João. Prazo: 10/03.
`;

const SAMPLE_TXT = `[10:00] Palestrante 1
Reunião de fechamento de contrato.
Objeção: cliente achou o preço alto.
`;

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "aos-meeting-home-"));
  mkdirSync(join(home, "souls", "test-soul", "sessoes"), { recursive: true });
  return home;
}

async function withTempHome<T>(fn: (home: string) => Promise<T>): Promise<T> {
  const home = tempHome();
  const prevHome = process.env.ASSISTENTE_OS_HOME;
  process.env.ASSISTENTE_OS_HOME = home;
  try {
    return await fn(home);
  } finally {
    if (prevHome === undefined) delete process.env.ASSISTENTE_OS_HOME;
    else process.env.ASSISTENTE_OS_HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  }
}

test("meetingIngestPipeline: ingere .vtt e persiste Markdown em sessoes/", async () => {
  await withTempHome(async (home) => {
    const vttPath = join(tmpdir(), `sample-${Date.now()}.vtt`);
    writeFileSync(vttPath, SAMPLE_VTT, "utf8");

    const result = await meetingIngestPipeline(vttPath, "test-soul");

    assert.ok(result.meetingPath.includes("test-soul"));
    assert.ok(result.meetingPath.endsWith("-meeting.md"));
    const content = readFileSync(result.meetingPath, "utf8");
    assert.match(content, /# Reunião - /);
    assert.equal(result.meetingPayload.fonteArquivo, basename(vttPath));
    rmSync(vttPath, { force: true });
  });
});

test("meetingIngestPipeline: ingere .srt sem quebrar (fallback sem Ollama incluso)", async () => {
  await withTempHome(async () => {
    const srtPath = join(tmpdir(), `sample-${Date.now()}.srt`);
    writeFileSync(srtPath, SAMPLE_SRT, "utf8");

    const result = await meetingIngestPipeline(srtPath, "test-soul");
    assert.ok(result.meetingPayload.rawTranscript && result.meetingPayload.rawTranscript.length > 0);
    assert.equal(result.meetingPayload.decisoes !== undefined, true);
    rmSync(srtPath, { force: true });
  });
});

test("meetingIngestPipeline: ingere .txt bruto", async () => {
  await withTempHome(async () => {
    const txtPath = join(tmpdir(), `sample-${Date.now()}.txt`);
    writeFileSync(txtPath, SAMPLE_TXT, "utf8");

    const result = await meetingIngestPipeline(txtPath, "test-soul");
    assert.ok(result.meetingPayload.rawTranscript);
    // O parser de .txt remove marcações de palestrante/timestamp.
    assert.ok(!result.meetingPayload.rawTranscript!.includes("Palestrante 1"));
    rmSync(txtPath, { force: true });
  });
});

test("meetingIngestPipeline: rodapé Markdown inclui telemetria (latency_ms sempre presente)", async () => {
  await withTempHome(async () => {
    const vttPath = join(tmpdir(), `sample-${Date.now()}.vtt`);
    writeFileSync(vttPath, SAMPLE_VTT, "utf8");

    const result = await meetingIngestPipeline(vttPath, "test-soul");
    const content = readFileSync(result.meetingPath, "utf8");

    assert.match(content, /## Telemetria/);
    assert.match(content, /latency_ms: \d+/);
    assert.equal(typeof result.meetingPayload.usage?.latencyMs, "number");
    rmSync(vttPath, { force: true });
  });
});
