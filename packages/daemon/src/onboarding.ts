import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getSoul, ensureSoulFiles, type Soul, type SoulConfig } from "@assistente-os/core";
import type { Familia } from "@assistente-os/core";

/**
 * Cria uma soul familiar a partir da soul base (mente_inclusiva).
 *
 * Fluxo:
 *   1. Cria diretório ~/.assistant-os/souls/familia_<telefone>/
 *   2. Copia sources/documentos/* da base (materiais compartilhados)
 *   3. Copia config.json da base
 *   4. Cria perfil.md e contexto.md iniciais
 *   5. Cria licoes.md, pessoas.md, sessoes/, decisoes/
 *   6. Roda memory_index para indexar materiais no RAG
 */
export async function criarSoulFamiliar(
  home: string,
  familia: Familia,
  baseSoulId: string,
): Promise<Soul> {
  const soulsRoot = join(home, "souls");
  const soulId = familia.soulId;
  const dir = join(soulsRoot, soulId);
  const baseDir = join(soulsRoot, baseSoulId);

  if (!existsSync(baseDir)) {
    throw new Error(`Soul base '${baseSoulId}' não encontrada em ${baseDir}`);
  }

  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, "sessoes"), { recursive: true });
  mkdirSync(join(dir, "decisoes"), { recursive: true });

  const baseSources = join(baseDir, "sources");
  if (existsSync(baseSources)) {
    cpSync(baseSources, join(dir, "sources"), { recursive: true });
  }

  const baseConfig = join(baseDir, "config.json");
  if (existsSync(baseConfig)) {
    cpSync(baseConfig, join(dir, "config.json"));
  }

  writeFileSync(join(dir, "perfil.md"), templatePerfil(familia), "utf8");
  writeFileSync(join(dir, "contexto.md"), templateContexto(familia), "utf8");
  writeFileSync(join(dir, "licoes.md"), "", "utf8");
  writeFileSync(join(dir, "pessoas.md"), "", "utf8");

  const config = getSoul(home, soulId);
  if (!config) {
    throw new Error(`Falha ao criar soul familiar '${soulId}'`);
  }

  return config;
}

function templatePerfil(f: Familia): string {
  const crianca = f.nomeCrianca ?? "A definir";
  return [
    `# Perfil — Família ${f.nomeFamilia}`,
    ``,
    `- **Telefone:** ${f.telefone}`,
    `- **Criança:** ${crianca}`,
    `- **Soul ID:** ${f.soulId}`,
    `- **Status:** ${f.status}`,
    `- **Fase anamnese:** ${faseLabel(f.anamnesePhase)}`,
    ``,
    `---`,
    ``,
    `## Dados Cadastrais`,
    ``,
    `Aguardando anamnese infanto-juvenil.`,
    ``,
    `## Identidade da Família`,
    ``,
    `Aguardando coleta de dados.`,
    ``,
  ].join("\n");
}

function templateContexto(f: Familia): string {
  const crianca = f.nomeCrianca ?? "A definir";
  return [
    `# Contexto — Família ${f.nomeFamilia}`,
    ``,
    `## Criança: ${crianca}`,
    ``,
    `Aguardando anamnese infanto-juvenil (fase 1).`,
    ``,
    `## Dinâmica Familiar`,
    ``,
    `Aguardando anamnese para psicoterapia familiar (fase 2).`,
    ``,
    `## Observações`,
    ``,
    `_Nenhuma observação registrada._`,
    ``,
  ].join("\n");
}

function faseLabel(phase: number): string {
  switch (phase) {
    case 0: return "não iniciado";
    case 1: return "anamnese infanto-juvenil em andamento";
    case 2: return "anamnese infanto-juvenil concluída";
    case 3: return "anamnese familiar em andamento";
    case 4: return "ambas concluídas (ativo)";
    default: return "desconhecido";
  }
}
