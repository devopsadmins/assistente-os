import { analyzeReference } from '../analyze-reference.js';
import { generateProject } from '../generate-project.js';
import { validateVisual } from '../validate-visual.js';
import { validateFunctional } from '../validate-functional.js';
import { iterateFix } from '../iterate-fix.js';
import { CacheManager } from '../utils/cache-manager.js';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import ora from 'ora';
import chalk from 'chalk';

export async function cloneCommand(
  url: string,
  options: {
    output: string;
    contentMapping: string;
    threshold: string;
    maxIterations: string;
    viewports: string;
    headless: string;
    report: string;
    cacheDir: string;
    forceFresh: boolean;
    verbose: boolean;
  }
) {
  const spinner = ora('Iniciando clone...').start();
  const startTime = Date.now();

  try {
    // Parse options
    const outputDir = resolve(options.output);
    const contentMapping = options.contentMapping ? JSON.parse(options.contentMapping) : {};
    const threshold = parseFloat(options.threshold);
    const maxIterations = parseInt(options.maxIterations);
    const viewportList = options.viewports.split(',').map(v => v.trim());
    const headless = options.headless === 'true';
    const reportPath = options.report ? resolve(options.report) : join(outputDir, 'validation-report.html');
    const cacheDir = options.cacheDir ? resolve(options.cacheDir) : undefined;
    const forceFresh = options.forceFresh;
    const verbose = options.verbose;

    // Setup cache manager
    const cacheManager = new CacheManager(cacheDir);

    // Generate cache key
    const viewportConfig = {
      mobile: { width: 375, height: 667 },
      tablet: { width: 768, height: 1024 },
      desktop: { width: 1440, height: 900 },
    };
    const cacheKey = cacheManager.generateKey(url, viewportConfig);

    // Check cache
    let analysis = null;
    if (!forceFresh) {
      spinner.text = 'Verificando cache...';
      analysis = cacheManager.load(cacheKey);
      if (analysis) {
        spinner.succeed(chalk.green('Cache válido encontrado!'));
      }
    }

    // Phase 1: Analyze
    if (!analysis) {
      spinner.text = 'Analisando site de referência...';
      analysis = await analyzeReference(url, {
        viewports: viewportConfig,
        headless,
        verbose,
        cacheKey,
        cacheManager,
      });
      spinner.succeed(chalk.green('Análise concluída'));
    }

    // Phase 2: Generate
    spinner.text = 'Gerando projeto Astro...';
    await generateProject(analysis, {
      outputDir,
      contentMapping,
      verbose,
    });
    spinner.succeed(chalk.green('Projeto gerado'));

    // Phase 3: Validate Visual
    spinner.text = 'Validando similaridade visual (≥90%)...';
    let visualResult = await validateVisual(outputDir, analysis, {
      threshold,
      viewports: viewportList,
      headless,
      verbose,
    });

    // Phase 4: Validate Functional
    spinner.text = 'Validando funcionalidades...';
    let functionalResult = await validateFunctional(outputDir, {
      headless,
      verbose,
    });

    // Phase 5: Iterate Fix if needed
    let iteration = 0;
    while ((!visualResult.passed || !functionalResult.passed) && iteration < maxIterations) {
      iteration++;
      spinner.text = `Iteração ${iteration}/${maxIterations}: Corrigindo gaps...`;
      
      await iterateFix(outputDir, analysis, visualResult, functionalResult, {
        threshold,
        viewports: viewportList,
        headless,
        verbose,
      });

      visualResult = await validateVisual(outputDir, analysis, {
        threshold,
        viewports: viewportList,
        headless,
        verbose,
      });
      functionalResult = await validateFunctional(outputDir, {
        headless,
        verbose,
      });
    }
    visualResult.iterations = iteration;

    // Generate final report
    spinner.text = 'Gerando relatório final...';
    await generateFinalReport(outputDir, analysis, visualResult, functionalResult, reportPath, url);
    spinner.succeed(chalk.green('Relatório gerado'));

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    
    console.log('\n' + chalk.bold('✅ Clone concluído com sucesso!'));
    console.log(chalk.gray(`⏱️  Tempo total: ${duration}s`));
    console.log(chalk.gray(`📁 Projeto: ${outputDir}`));
    console.log(chalk.gray(`📊 Relatório: ${reportPath}`));
    console.log(chalk.gray(`🎯 Fidelidade visual: ${(visualResult.overallSimilarity * 100).toFixed(1)}%`));
    console.log(chalk.gray(`⚙️  Testes funcionais: ${functionalResult.passed ? 'PASS' : 'FAIL'}`));
    
    if (!visualResult.passed || !functionalResult.passed) {
      console.log(chalk.yellow('\n⚠️  Validação não atingiu 100% dos critérios após iterações.'));
      console.log(chalk.gray('Verifique o relatório para detalhes e ajustes manuais.'));
      process.exit(1);
    }

  } catch (error) {
    spinner.fail(chalk.red('Erro durante clone:'));
    console.error(error);
    process.exit(1);
  }
}

export async function generateFinalReport(
  outputDir: string,
  analysis: any,
  visualResult: any,
  functionalResult: any,
  reportPath: string,
  sourceUrl: string
) {
  const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Relatório de Validação - Site Cloner</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1a1a2e; background: #f8fafc; }
    .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }
    header { background: linear-gradient(135deg, #1e293b 0%, #334155 100%); color: white; padding: 2rem; border-radius: 12px; margin-bottom: 2rem; }
    h1 { font-size: 1.75rem; font-weight: 700; margin-bottom: 0.5rem; }
    .meta { display: flex; gap: 2rem; flex-wrap: wrap; font-size: 0.9rem; opacity: 0.9; }
    .score-card { background: white; border-radius: 12px; padding: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 1.5rem; }
    .score-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; }
    .score-item { text-align: center; padding: 1rem; background: #f8fafc; border-radius: 8px; }
    .score-value { font-size: 2rem; font-weight: 700; }
    .score-label { font-size: 0.875rem; color: #64748b; margin-top: 0.25rem; }
    .pass { color: #059669; }
    .fail { color: #dc2626; }
    .warn { color: #d97706; }
    .section { background: white; border-radius: 12px; padding: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 1.5rem; }
    .section h2 { font-size: 1.25rem; font-weight: 600; margin-bottom: 1rem; padding-bottom: 0.5rem; border-bottom: 2px solid #e2e8f0; }
    .diff-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1rem; }
    .diff-item { border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
    .diff-header { background: #f1f5f9; padding: 0.75rem 1rem; font-weight: 600; }
    .diff-content { padding: 1rem; display: flex; gap: 1rem; align-items: center; }
    .diff-image { max-width: 100%; height: auto; border-radius: 4px; border: 1px solid #e2e8f0; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 0.75rem 1rem; text-align: left; border-bottom: 1px solid #e2e8f0; }
    th { background: #f8fafc; font-weight: 600; }
    .badge { display: inline-block; padding: 0.25rem 0.5rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 600; }
    .badge-pass { background: #dcfce7; color: #166534; }
    .badge-fail { background: #fee2e2; color: #991b1b; }
    .badge-warn { background: #fef3c7; color: #92400e; }
    .slider-container { position: relative; width: 100%; max-width: 600px; margin: 1rem auto; }
    .slider-images { position: relative; width: 100%; aspect-ratio: 16/9; overflow: hidden; border-radius: 8px; }
    .slider-images img { position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; }
    .slider-images .after { clip-path: inset(0 50% 0 0); }
    .slider-handle { position: absolute; top: 0; bottom: 0; left: 50%; width: 4px; background: white; transform: translateX(-50%); pointer-events: none; z-index: 10; }
    footer { text-align: center; padding: 2rem; color: #64748b; font-size: 0.875rem; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>📋 Relatório de Validação - Site Cloner</h1>
      <div class="meta">
        <span>🔗 Fonte: <a href="${sourceUrl}" target="_blank" style="color: #93c5fd;">${sourceUrl}</a></span>
        <span>📅 Gerado: ${new Date().toLocaleString('pt-BR')}</span>
        <span>🎯 Threshold: ${(visualResult.threshold * 100).toFixed(0)}%</span>
      </div>
    </header>

    <div class="score-card">
      <h2 style="margin-bottom: 1rem;">📊 Resumo de Fidelidade</h2>
      <div class="score-grid">
        <div class="score-item">
          <div class="score-value ${visualResult.overallSimilarity >= visualResult.threshold ? 'pass' : 'fail'}">${(visualResult.overallSimilarity * 100).toFixed(1)}%</div>
          <div class="score-label">Similaridade Geral (Desktop)</div>
        </div>
        <div class="score-item">
          <div class="score-value ${visualResult.heroSimilarity >= 0.95 ? 'pass' : 'fail'}">${(visualResult.heroSimilarity * 100).toFixed(1)}%</div>
          <div class="score-label">Hero Section (≥95%)</div>
        </div>
        <div class="score-item">
          <div class="score-value ${visualResult.headerSimilarity >= 0.95 ? 'pass' : 'fail'}">${(visualResult.headerSimilarity * 100).toFixed(1)}%</div>
          <div class="score-label">Header/Nav (≥95%)</div>
        </div>
        <div class="score-item">
          <div class="score-value ${visualResult.ctaSimilarity >= 0.93 ? 'pass' : 'fail'}">${(visualResult.ctaSimilarity * 100).toFixed(1)}%</div>
          <div class="score-label">CTAs Primários (≥93%)</div>
        </div>
        <div class="score-item">
          <div class="score-value ${visualResult.mobileSimilarity >= 0.88 ? 'pass' : 'fail'}">${(visualResult.mobileSimilarity * 100).toFixed(1)}%</div>
          <div class="score-label">Mobile (≥88%)</div>
        </div>
        <div class="score-item">
          <div class="score-value ${visualResult.tabletSimilarity >= 0.88 ? 'pass' : 'fail'}">${(visualResult.tabletSimilarity * 100).toFixed(1)}%</div>
          <div class="score-label">Tablet (≥88%)</div>
        </div>
        <div class="score-item">
          <div class="score-value ${functionalResult.passed ? 'pass' : 'fail'}">${functionalResult.passed ? '✅' : '❌'}</div>
          <div class="score-label">Testes Funcionais</div>
        </div>
        <div class="score-item">
          <div class="score-value">${visualResult.iterations}</div>
          <div class="score-label">Iterações de Correção</div>
        </div>
      </div>
    </div>

    <div class="section">
      <h2>🎨 Validação Visual - Diffs Principais</h2>
      <div class="diff-grid">
        ${Object.entries(visualResult.componentDiffs || {}).map(([name, diff]: [string, any]) => `
        <div class="diff-item">
          <div class="diff-header">${name} (${(diff.similarity * 100).toFixed(1)}%)</div>
          <div class="diff-content">
            <img class="diff-image" src="${diff.diffImagePath || ''}" alt="Diff ${name}">
          </div>
        </div>
        `).join('')}
      </div>
    </div>

    <div class="section">
      <h2>⚙️ Testes Funcionais</h2>
      <table>
        <thead>
          <tr><th>Teste</th><th>Status</th><th>Duração</th><th>Detalhes</th></tr>
        </thead>
        <tbody>
          ${functionalResult.tests.map((test: any) => `
          <tr>
            <td>${test.name}</td>
            <td><span class="badge ${test.passed ? 'badge-pass' : 'badge-fail'}">${test.passed ? 'PASS' : 'FAIL'}</span></td>
            <td>${test.duration}ms</td>
            <td>${test.details || ''}</td>
          </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <div class="section">
      <h2>🎨 Design Tokens Extraídos</h2>
      <div class="diff-grid">
        <div class="diff-item">
          <div class="diff-header">Cores (${Object.keys(analysis.designTokens.colors).length})</div>
          <div class="diff-content">
            <div style="display: flex; flex-wrap: wrap; gap: 0.5rem;">
              ${Object.entries(analysis.designTokens.colors).slice(0, 20).map(([name, value]) => `
                <div style="width: 40px; height: 40px; background: ${value}; border-radius: 4px; border: 1px solid #e2e8f0;" title="${name}: ${value}"></div>
              `).join('')}
            </div>
          </div>
        </div>
        <div class="diff-item">
          <div class="diff-header">Tipografia</div>
          <div class="diff-content">
            <pre style="font-size: 0.75rem; overflow: auto;">${JSON.stringify(analysis.designTokens.typography, null, 2)}</pre>
          </div>
        </div>
        <div class="diff-item">
          <div class="diff-header">Spacing</div>
          <div class="diff-content">
            <pre style="font-size: 0.75rem; overflow: auto;">${JSON.stringify(analysis.designTokens.spacing, null, 2)}</pre>
          </div>
        </div>
      </div>
    </div>

    <footer>
      Gerado por <strong>site-cloner</strong> — Clone visual com validação ≥90%
    </footer>
  </div>
</body>
</html>`;

  writeFileSync(reportPath, html);
}