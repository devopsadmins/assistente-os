import { analyzeReference } from '../analyze-reference.js';
import { CacheManager } from '../utils/cache-manager.js';
import { resolve } from 'path';
import ora from 'ora';
import chalk from 'chalk';

export async function analyzeCommand(
  url: string,
  options: {
    output: string;
    cacheDir: string;
    forceFresh: boolean;
    verbose: boolean;
  }
) {
  const spinner = ora('Analisando site de referência...').start();

  try {
    const outputDir = options.output ? resolve(options.output) : null;
    const cacheDir = options.cacheDir ? resolve(options.cacheDir) : undefined;
    const forceFresh = options.forceFresh;
    const verbose = options.verbose;

    const cacheManager = new CacheManager(cacheDir);
    const viewportConfig = {
      mobile: { width: 375, height: 667 },
      tablet: { width: 768, height: 1024 },
      desktop: { width: 1440, height: 900 },
    };
    const cacheKey = cacheManager.generateKey(url, viewportConfig);

    let analysis = null;
    if (!forceFresh) {
      spinner.text = 'Verificando cache...';
      analysis = cacheManager.load(cacheKey);
      if (analysis) {
        spinner.succeed(chalk.green('Cache válido encontrado!'));
      }
    }

    if (!analysis) {
      spinner.text = 'Executando análise completa...';
      analysis = await analyzeReference(url, {
        viewports: viewportConfig,
        headless: true,
        verbose,
        cacheKey,
        cacheManager,
      });
      spinner.succeed(chalk.green('Análise concluída'));
    }

    if (outputDir) {
      const { writeFileSync, mkdirSync, existsSync } = await import('fs');
      if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
      writeFileSync(resolve(outputDir, 'analysis.json'), JSON.stringify(analysis, null, 2));
      console.log(chalk.gray(`\n📁 Análise salva em: ${outputDir}/analysis.json`));
    }

    console.log(chalk.bold('\n✅ Análise concluída!'));
    console.log(chalk.gray(`🎨 Cores: ${Object.keys(analysis.designTokens.colors).length}`));
    console.log(chalk.gray(`📝 Componentes: ${analysis.componentMap.length}`));
    console.log(chalk.gray(`🔄 Interações: ${analysis.interactions.length}`));
    console.log(chalk.gray(`📸 Screenshots: ${Object.keys(analysis.screenshots.viewport).length} viewports`));

  } catch (error) {
    spinner.fail(chalk.red('Erro na análise:'));
    console.error(error);
    process.exit(1);
  }
}