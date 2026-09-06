import { AnalysisCache } from './utils/cache-manager.js';
import { generateProject } from './generate-project.js';
import { validateVisual, VisualValidationResult } from './validate-visual.js';
import { validateFunctional, FunctionalValidationResult } from './validate-functional.js';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import ora from 'ora';
import chalk from 'chalk';

export interface IterateFixOptions {
  threshold: number;
  viewports: string[];
  headless: boolean;
  verbose: boolean;
}

export async function iterateFix(
  projectDir: string,
  analysis: AnalysisCache,
  visualResult: VisualValidationResult,
  functionalResult: FunctionalValidationResult,
  options: IterateFixOptions
): Promise<void> {
  const spinner = ora('Analisando gaps para correção...').start();

  try {
    // Identify top visual gaps
    const visualGaps = identifyVisualGaps(visualResult);
    const functionalGaps = identifyFunctionalGaps(functionalResult);
    
    const allGaps = [...visualGaps, ...functionalGaps].slice(0, 3);
    
    if (allGaps.length === 0) {
      spinner.succeed('Nenhum gap identificado');
      return;
    }

    spinner.text = `Aplicando ${allGaps.length} correções...`;
    
    // Apply fixes to design tokens
    const updatedTokens = applyTokenFixes(analysis.designTokens, allGaps);
    analysis.designTokens = updatedTokens;

    // Apply fixes to component map
    const updatedComponents = applyComponentFixes(analysis.componentMap, allGaps);
    analysis.componentMap = updatedComponents;

    // Regenerate project
    spinner.text = 'Regenerando projeto com correções...';
    await generateProject(analysis, {
      outputDir: projectDir,
      contentMapping: {},
      verbose: options.verbose,
    });

    spinner.succeed(chalk.green('Correções aplicadas e projeto regenerado'));

  } catch (error) {
    spinner.fail(chalk.red('Erro na iteração de correção:'));
    throw error;
  }
}

function identifyVisualGaps(result: VisualValidationResult): Array<{ type: string; component: string; severity: number; details: string }> {
  const gaps: Array<{ type: string; component: string; severity: number; details: string }> = [];

  if (result.overallSimilarity < result.threshold) {
    gaps.push({
      type: 'visual',
      component: 'overall',
      severity: result.threshold - result.overallSimilarity,
      details: `Similaridade geral ${(result.overallSimilarity * 100).toFixed(1)}% abaixo do threshold ${(result.threshold * 100).toFixed(0)}%`,
    });
  }

  if (result.heroSimilarity < 0.95) {
    gaps.push({
      type: 'visual',
      component: 'hero',
      severity: 0.95 - result.heroSimilarity,
      details: `Hero section ${(result.heroSimilarity * 100).toFixed(1)}% (mínimo 95%)`,
    });
  }

  if (result.headerSimilarity < 0.95) {
    gaps.push({
      type: 'visual',
      component: 'header',
      severity: 0.95 - result.headerSimilarity,
      details: `Header/Nav ${(result.headerSimilarity * 100).toFixed(1)}% (mínimo 95%)`,
    });
  }

  if (result.ctaSimilarity < 0.93) {
    gaps.push({
      type: 'visual',
      component: 'cta',
      severity: 0.93 - result.ctaSimilarity,
      details: `CTAs primários ${(result.ctaSimilarity * 100).toFixed(1)}% (mínimo 93%)`,
    });
  }

  if (result.mobileSimilarity < 0.88) {
    gaps.push({
      type: 'visual',
      component: 'mobile',
      severity: 0.88 - result.mobileSimilarity,
      details: `Mobile viewport ${(result.mobileSimilarity * 100).toFixed(1)}% (mínimo 88%)`,
    });
  }

  if (result.tabletSimilarity < 0.88) {
    gaps.push({
      type: 'visual',
      component: 'tablet',
      severity: 0.88 - result.tabletSimilarity,
      details: `Tablet viewport ${(result.tabletSimilarity * 100).toFixed(1)}% (mínimo 88%)`,
    });
  }

  // Component-specific diffs
  for (const [name, diff] of Object.entries(result.componentDiffs)) {
    if (diff.similarity < 0.85) {
      gaps.push({
        type: 'visual',
        component: name,
        severity: 0.85 - diff.similarity,
        details: `Componente ${name}: ${(diff.similarity * 100).toFixed(1)}%`,
      });
    }
  }

  return gaps.sort((a, b) => b.severity - a.severity);
}

function identifyFunctionalGaps(result: FunctionalValidationResult): Array<{ type: string; component: string; severity: number; details: string }> {
  const gaps: Array<{ type: string; component: string; severity: number; details: string }> = [];

  for (const test of result.tests) {
    if (!test.passed) {
      gaps.push({
        type: 'functional',
        component: test.name.toLowerCase().replace(/\s+/g, '-'),
        severity: 1.0, // Functional failures are high severity
        details: `${test.name}: ${test.details}`,
      });
    }
  }

  return gaps;
}

function applyTokenFixes(tokens: any, gaps: any[]): any {
  const updated = { ...tokens };

  for (const gap of gaps) {
    switch (gap.component) {
      case 'hero':
        // Increase hero contrast, adjust spacing
        updated.colors = adjustColorContrast(updated.colors, 1.1);
        updated.spacing = scaleSpacing(updated.spacing, 1.05);
        break;
      case 'header':
        // Adjust header height, colors
        updated.spacing = scaleSpacing(updated.spacing, 1.02);
        break;
      case 'cta':
        // Make CTAs more prominent
        updated.colors = enhanceCTAColors(updated.colors);
        break;
      case 'mobile':
      case 'tablet':
        // Adjust responsive spacing
        updated.spacing = scaleSpacing(updated.spacing, 0.95);
        break;
      case 'overall':
        // General adjustments
        updated.spacing = scaleSpacing(updated.spacing, 1.03);
        break;
    }
  }

  return updated;
}

function applyComponentFixes(components: any[], gaps: any[]): any[] {
  // For now, return as-is. In future, could modify component structure
  return components;
}

function adjustColorContrast(colors: Record<string, string>, factor: number): Record<string, string> {
  const updated: Record<string, string> = {};
  for (const [key, value] of Object.entries(colors)) {
    updated[key] = value; // Simplified - would need color manipulation
  }
  return updated;
}

function scaleSpacing(spacing: Record<string, string>, factor: number): Record<string, string> {
  const updated: Record<string, string> = {};
  for (const [key, value] of Object.entries(spacing)) {
    const rem = parseFloat(value);
    if (!isNaN(rem)) {
      updated[key] = `${(rem * factor).toFixed(3)}rem`;
    } else {
      updated[key] = value;
    }
  }
  return updated;
}

function enhanceCTAColors(colors: Record<string, string>): Record<string, string> {
  // Boost primary/accent colors
  const updated = { ...colors };
  for (const [key, value] of Object.entries(colors)) {
    if (key.includes('primary') || key.includes('accent') || key.includes('cta')) {
      updated[key] = value; // Would enhance saturation/brightness
    }
  }
  return updated;
}