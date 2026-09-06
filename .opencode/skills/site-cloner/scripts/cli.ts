#!/usr/bin/env node
import { program } from 'commander';
import { cloneCommand } from './commands/clone.js';
import { analyzeCommand } from './commands/analyze.js';
import { validateCommand } from './commands/validate.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8'));
const version = packageJson.version;

program
  .name('site-cloner')
  .description('Clone visual de sites de referência → projeto Astro 4 + Tailwind com validação ≥90%')
  .version(version);

program
  .command('clone <url>')
  .description('Clona site de referência e gera projeto Astro validado')
  .option('-o, --output <dir>', 'Diretório de saída', './cloned-site')
  .option('-c, --content-mapping <json>', 'Mapeamento seletor → conteúdo: \'{"h1": "Título"}\'')
  .option('-t, --threshold <number>', 'Threshold visual (0-1)', '0.90')
  .option('-i, --max-iterations <number>', 'Max iterações de correção', '5')
  .option('-v, --viewports <list>', 'Viewports (mobile,tablet,desktop)', 'mobile,tablet,desktop')
  .option('--headless <boolean>', 'Playwright headless', 'true')
  .option('-r, --report <path>', 'Relatório HTML de validação')
  .option('--cache-dir <dir>', 'Diretório cache')
  .option('-f, --force-fresh', 'Ignora cache, re-analisa referência')
  .option('--verbose', 'Log detalhado')
  .action(cloneCommand);

program
  .command('analyze <url>')
  .description('Apenas analisa referência (extraí tokens, componentes, screenshots)')
  .option('-o, --output <dir>', 'Diretório de saída para análise')
  .option('--cache-dir <dir>', 'Diretório cache')
  .option('-f, --force-fresh', 'Ignora cache')
  .option('--verbose', 'Log detalhado')
  .action(analyzeCommand);

program
  .command('validate <projectDir>')
  .description('Valida projeto já gerado (visual + funcional)')
  .option('-r, --report <path>', 'Relatório HTML')
  .option('--threshold <number>', 'Threshold visual', '0.90')
  .option('--verbose', 'Log detalhado')
  .action(validateCommand);

program.parse();