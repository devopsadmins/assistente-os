import { validateVisual } from '../validate-visual.js';
import { validateFunctional } from '../validate-functional.js';
import { generateFinalReport } from '../commands/clone.js';
import { resolve } from 'path';
import ora from 'ora';
import chalk from 'chalk';

export async function validateCommand(
  projectDir: string,
  options: {
    report: string;
    threshold: string;
    verbose: boolean;
  }
) {
  const spinner = ora('Validando projeto...').start();

  try {
    const projectPath = resolve(projectDir);
    const threshold = parseFloat(options.threshold);
    const verbose = options.verbose;
    const reportPath = options.report ? resolve(options.report) : resolve(projectDir, 'validation-report.html');

    // Load analysis if exists
    const analysisPath = resolve(projectDir, 'design-tokens.json');
    const { existsSync, readFileSync } = await import('fs');
    let analysis = null;
    if (existsSync(analysisPath)) {
      analysis = JSON.parse(readFileSync(analysisPath, 'utf-8'));
    }

    // Visual validation
    spinner.text = 'Validando similaridade visual...';
    const visualResult = await validateVisual(projectPath, analysis, {
      threshold,
      viewports: ['mobile', 'tablet', 'desktop'],
      headless: true,
      verbose,
    });

    // Functional validation
    spinner.text = 'Validando funcionalidades...';
    const functionalResult = await validateFunctional(projectPath, {
      headless: true,
      verbose,
    });

    // Generate report
    spinner.text = 'Gerando relatório...';
    await generateFinalReport(projectPath, analysis, visualResult, functionalResult, reportPath, 'local-project');
    spinner.succeed(chalk.green('Validação concluída'));

    console.log(chalk.bold('\n📊 Resultados:'));
    console.log(chalk.gray(`🎯 Fidelidade visual: ${(visualResult.overallSimilarity * 100).toFixed(1)}% ${visualResult.passed ? '✅' : '❌'}`));
    console.log(chalk.gray(`⚙️  Testes funcionais: ${functionalResult.passed ? '✅ PASS' : '❌ FAIL'}`));
    console.log(chalk.gray(`📄 Relatório: ${reportPath}`));

    if (!visualResult.passed || !functionalResult.passed) {
      process.exit(1);
    }

  } catch (error) {
    spinner.fail(chalk.red('Erro na validação:'));
    console.error(error);
    process.exit(1);
  }
}