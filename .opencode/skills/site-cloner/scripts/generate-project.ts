import { AnalysisCache } from './utils/cache-manager.js';
import { mkdirSync, writeFileSync, copyFileSync, existsSync, cpSync, readFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import Handlebars from 'handlebars';
import ora from 'ora';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, '../templates');
const ASTRO_TEMPLATES_DIR = join(__dirname, '../references/astro-templates');

export interface GenerateOptions {
  outputDir: string;
  contentMapping: Record<string, string>;
  verbose: boolean;
}

export async function generateProject(analysis: AnalysisCache, options: GenerateOptions): Promise<void> {
  const { outputDir, contentMapping, verbose } = options;
  const spinner = ora('Gerando estrutura do projeto...').start();

  try {
    // Create directory structure
    const dirs = [
      'src/components',
      'src/components/ui',
      'src/layouts',
      'src/pages',
      'src/styles',
      'src/scripts',
      'public/images',
      'public/fonts',
    ];
    dirs.forEach(d => mkdirSync(join(outputDir, d), { recursive: true }));

    // Generate config files
    await generateConfigFiles(outputDir, analysis);
    spinner.text = 'Arquivos de configuração gerados';

    // Generate Astro components
    await generateComponents(outputDir, analysis);
    spinner.text = 'Componentes Astro gerados';

    // Generate layouts
    await generateLayouts(outputDir, analysis);
    spinner.text = 'Layouts gerados';

    // Generate pages
    await generatePages(outputDir, analysis, contentMapping);
    spinner.text = 'Páginas geradas';

    // Generate styles
    await generateStyles(outputDir, analysis);
    spinner.text = 'Estilos globais gerados';

    // Copy assets
    await copyAssets(outputDir, analysis);
    spinner.text = 'Assets copiados';

    // Generate README
    await generateReadme(outputDir, analysis);
    spinner.text = 'README gerado';

    spinner.succeed('Projeto gerado com sucesso!');
  } catch (error) {
    spinner.fail('Erro ao gerar projeto:');
    throw error;
  }

  // Make the project preview-ready so validate-visual/validate-functional can
  // run `astro preview` against it. Opt out with SITE_CLONER_NO_INSTALL=1
  // (e.g. offline / when the caller wires the project up itself).
  if (process.env.SITE_CLONER_NO_INSTALL !== '1') {
    await installAndBuild(outputDir, verbose);
  }
}

async function installAndBuild(outputDir: string, verbose: boolean): Promise<void> {
  const spinner = ora('Instalando dependências do projeto gerado...').start();
  const stdio = verbose ? 'inherit' : 'ignore';
  try {
    execFileSync('npm', ['install', '--no-audit', '--no-fund', '--loglevel', 'error'], {
      cwd: outputDir,
      stdio,
      timeout: 5 * 60 * 1000,
    });
    spinner.text = 'Compilando projeto gerado (astro build)...';
    execFileSync('npm', ['run', 'build'], {
      cwd: outputDir,
      stdio,
      timeout: 5 * 60 * 1000,
    });
    spinner.succeed('Projeto gerado pronto para preview');
  } catch (error) {
    spinner.fail('Falha ao instalar/compilar o projeto gerado');
    throw error;
  }
}

async function generateConfigFiles(outputDir: string, analysis: AnalysisCache): Promise<void> {
  const tokens = analysis.designTokens;

  // package.json
  const packageJson = renderTemplateFile('package.json.hbs', {
    name: 'cloned-site',
    version: '1.0.0',
  });
  writeFileSync(join(outputDir, 'package.json'), packageJson);

  // astro.config.mjs
  const astroConfig = renderTemplateFile('astro.config.mjs.hbs', {});
  writeFileSync(join(outputDir, 'astro.config.mjs'), astroConfig);

  // tailwind.config.ts
  const tailwindConfig = generateTailwindConfig(tokens);
  writeFileSync(join(outputDir, 'tailwind.config.ts'), tailwindConfig);

  // tsconfig.json
  const tsconfig = renderTemplateFile('tsconfig.json.hbs', {});
  writeFileSync(join(outputDir, 'tsconfig.json'), tsconfig);

  // .gitignore
  writeFileSync(join(outputDir, '.gitignore'), `
dist/
node_modules/
.env
*.log
.cache/
coverage/
.astro/
`);

  // .prettierrc
  writeFileSync(join(outputDir, '.prettierrc'), JSON.stringify({
    pluginSearchDirs: false,
    printWidth: 100,
    singleQuote: true,
    tabWidth: 2,
    trailingComma: 'es5',
  }, null, 2));
}

/** First `*-accent` extracted colour, else the first plain rgb(), else a blue. */
function pickAccentColor(tokens: any): string {
  const entries = Object.entries((tokens?.colors ?? {}) as Record<string, string>);
  const isPlainRgb = (v: string) => /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/.test(v.trim());
  return (
    entries.find(([k, v]) => k.includes('accent') && isPlainRgb(v))?.[1] ??
    entries.find(([, v]) => isPlainRgb(v))?.[1] ??
    'rgb(37, 99, 235)'
  );
}

function rgbTriple(color: string): [number, number, number] {
  const m = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [37, 99, 235];
}

function mixRgb(a: [number, number, number], b: [number, number, number], t: number): string {
  const c = (x: number, y: number) => Math.round(x + (y - x) * t);
  return `rgb(${c(a[0], b[0])}, ${c(a[1], b[1])}, ${c(a[2], b[2])})`;
}

/** Derive a 50–900 Tailwind-style scale from a single base colour so the
 * scaffold's `primary-*` utilities resolve. */
function buildColorScale(base: string): Record<string, string> {
  const rgb = rgbTriple(base);
  const white: [number, number, number] = [255, 255, 255];
  const black: [number, number, number] = [0, 0, 0];
  const solid = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  return {
    '50': mixRgb(rgb, white, 0.9),
    '100': mixRgb(rgb, white, 0.8),
    '200': mixRgb(rgb, white, 0.6),
    '300': mixRgb(rgb, white, 0.4),
    '400': mixRgb(rgb, white, 0.2),
    '500': solid,
    '600': mixRgb(rgb, black, 0.15),
    '700': mixRgb(rgb, black, 0.3),
    '800': mixRgb(rgb, black, 0.45),
    '900': mixRgb(rgb, black, 0.6),
    DEFAULT: solid,
  };
}

function generateTailwindConfig(tokens: any): string {
  const colors = Object.entries(tokens.colors).reduce((acc: any, [key, value]) => {
    // Try to parse as color for Tailwind
    const parsed = parseColorForTailwind(value as string);
    if (parsed) {
      acc[key] = parsed;
    }
    return acc;
  }, {});

  // The scaffold stylesheet references `primary-*`; synthesise it from the
  // reference's accent colour (default Tailwind palettes cover gray/etc).
  const primaryScale = buildColorScale(pickAccentColor(tokens));
  colors.primary = primaryScale;
  colors.accent = primaryScale;

  const spacing = Object.entries(tokens.spacing).reduce((acc: any, [key, value]) => {
    const rem = parseFloat(value as string);
    if (!isNaN(rem)) {
      acc[key] = `${rem}rem`;
    }
    return acc;
  }, {});

  const fontSizes = Object.entries(tokens.typography.fontSizes).reduce((acc: any, [key, value]) => {
    const rem = parseFloat(value as string);
    if (!isNaN(rem)) {
      acc[key] = `${rem}rem`;
    }
    return acc;
  }, {});

  const fontFamilies = tokens.typography.fontFamilies;

  const borderRadius = Object.entries(tokens.borderRadius).reduce((acc: any, [key, value]) => {
    const rem = parseFloat(value as string);
    if (!isNaN(rem)) {
      acc[key] = `${rem}rem`;
    }
    return acc;
  }, {});

  const shadows = tokens.shadows;

  const transitions = tokens.transitions;

  return `import type { Config } from 'tailwindcss';

export default {
  content: [
    './src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}',
  ],
  theme: {
    extend: {
      colors: ${JSON.stringify(colors, null, 6)},
      spacing: ${JSON.stringify(spacing, null, 6)},
      fontSize: ${JSON.stringify(fontSizes, null, 6)},
      fontFamily: ${JSON.stringify(fontFamilies, null, 6)},
      borderRadius: ${JSON.stringify(borderRadius, null, 6)},
      boxShadow: ${JSON.stringify(shadows, null, 6)},
      transitionDuration: {
        '0': '0ms',
        '75': '75ms',
        '100': '100ms',
        '150': '150ms',
        '200': '200ms',
        '300': '300ms',
        '500': '500ms',
        '700': '700ms',
        '1000': '1000ms',
      },
      transitionTimingFunction: {
        DEFAULT: 'cubic-bezier(0.4, 0, 0.2, 1)',
        linear: 'linear',
        in: 'cubic-bezier(0.4, 0, 1, 1)',
        out: 'cubic-bezier(0, 0, 0.2, 1)',
        'in-out': 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
      zIndex: ${JSON.stringify(tokens.zIndices, null, 6)},
    },
  },
  plugins: [],
} satisfies Config;
`;
}

function parseColorForTailwind(color: string): Record<string, string> | null {
  const c = color.trim();
  // Skip multi-token values (e.g. a `border-color` shorthand that resolved to
  // three colours) — they are not valid single CSS colour values.
  if (!/^(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))$/.test(c)) {
    return null;
  }
  return { DEFAULT: c };
}

async function generateComponents(outputDir: string, analysis: AnalysisCache): Promise<void> {
  // Generate UI base components from templates
  const uiComponents = [
    'Button.astro',
    'Card.astro',
    'Section.astro',
    'Container.astro',
    'Grid.astro',
    'Badge.astro',
    'Input.astro',
    'Modal.astro',
  ];

  for (const comp of uiComponents) {
    const srcPath = join(ASTRO_TEMPLATES_DIR, comp);
    const destPath = join(outputDir, 'src/components/ui', comp);
    if (existsSync(srcPath)) {
      cpSync(srcPath, destPath);
    } else {
      // Generate basic component
      writeFileSync(destPath, generateBasicComponent(comp.replace('.astro', '')));
    }
  }

  // Generate mapped components from analysis
  const mappedComponents = generateMappedComponents(analysis.componentMap);
  for (const [name, content] of Object.entries(mappedComponents)) {
    writeFileSync(join(outputDir, 'src/components', `${name}.astro`), content);
  }
}

function generateBasicComponent(name: string): string {
  const pascalName = name.charAt(0).toUpperCase() + name.slice(1);
  return `---
interface Props {
  class?: string;
  children?: any;
}
const { class: className = '', children, ...attrs } = Astro.props;
---
<div class={className} {...attrs}>
  <slot>{children}</slot>
</div>

<style>
  /* ${pascalName} base styles */
</style>
`;
}

function generateMappedComponents(componentMap: any[]): Record<string, string> {
  // One stub per distinct component *type* seen in the reference (deduplicated,
  // depth-limited). These are scaffolding hints for manual refinement — the
  // generated index.astro does not import them — so keep the set small and the
  // names meaningful instead of concatenating the ancestry into noise.
  const components: Record<string, string> = {};
  const MAX = 15;

  function walk(comp: any, depth: number): void {
    if (!comp || depth > 4 || Object.keys(components).length >= MAX) return;
    const name = String(comp.type || 'Div').replace(/[^A-Za-z0-9]/g, '');
    if (name && !components[name] && !['Div', 'Section', 'Grid'].includes(name)) {
      components[name] = generateComponentFromMap(comp);
    }
    (comp.children ?? []).forEach((child: any) => walk(child, depth + 1));
  }

  componentMap.forEach((comp) => walk(comp, 0));
  return components;
}

function generateComponentFromMap(comp: { props: Record<string, unknown>; styles: Record<string, string>; type: string; selector: string }): string {
  const props = Object.keys(comp.props).map(k => `${k}?: string;`).join('\n  ');
  const classNames = Object.entries(comp.styles)
    .map(([k, v]: [string, string]) => `${kebabCase(k)}:${escapeCss(v)}`)
    .join('; ');

  return `---
interface Props {
  ${props}
  class?: string;
}
const { class: className = '', ...attrs } = Astro.props;
---
<${comp.type.toLowerCase()} class={\`\${className} \${Object.entries(attrs).map(([k,v]) => k + ':' + v).join(' ')}\`} {...attrs}>
  <slot />
</${comp.type.toLowerCase()}>

<style>
  /* Generated from: ${comp.selector} */
</style>
`;
}

function kebabCase(str: string): string {
  return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

function escapeCss(val: string): string {
  return val.replace(/;/g, '\\;').replace(/:/g, '\\:');
}

async function generateLayouts(outputDir: string, analysis: AnalysisCache): Promise<void> {
  const layout = `---
import '../styles/global.css';
interface Props {
  title?: string;
  description?: string;
}
const { title = 'Cloned Site', description = '' } = Astro.props;
---
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content={description} />
    <title>{title}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  </head>
  <body class="font-sans antialiased">
    <slot />
  </body>
</html>
`;
  writeFileSync(join(outputDir, 'src/layouts/BaseLayout.astro'), layout);
}

async function generatePages(outputDir: string, analysis: AnalysisCache, contentMapping: Record<string, string>): Promise<void> {
  const page = `---
import BaseLayout from '../layouts/BaseLayout.astro';
---
<BaseLayout title="${analysis.meta.url}" description="Cloned site from ${analysis.meta.url}">
  <header class="site-header">
    <div class="container">
      <a href="#hero" class="site-brand">${contentMapping['.brand'] || 'Brand'}</a>
      <nav aria-label="Principal">
        <a href="#content">Conteúdo</a>
        <a href="#site-footer">Contato</a>
      </nav>
    </div>
  </header>
  <main>
    <!-- Hero Section -->
    <section id="hero" class="hero-section">
      <div class="container">
        <h1 class="hero-title">${contentMapping['h1'] || 'Título Principal'}</h1>
        <p class="hero-subtitle">${contentMapping['.hero-subtitle'] || 'Subtítulo do hero'}</p>
        <div class="hero-ctas">
          <a href="#content" class="btn btn-primary">${contentMapping['.btn-primary'] || 'CTA Principal'}</a>
          <a href="#site-footer" class="btn btn-secondary">${contentMapping['.btn-secondary'] || 'CTA Secundário'}</a>
        </div>
      </div>
    </section>

    <!-- Content Sections -->
    <section id="content" class="content-section">
      <div class="container">
        <h2>Seção de Conteúdo</h2>
        <p>Conteúdo extraído da referência. Substitua conforme necessário.</p>
      </div>
    </section>

    <!-- Footer -->
    <footer id="site-footer" class="site-footer">
      <div class="container">
        <p>&copy; ${new Date().getFullYear()} Cloned Site. Original: <a href="${analysis.meta.url}" target="_blank">${analysis.meta.url}</a></p>
      </div>
    </footer>
  </main>
</BaseLayout>
`;
  writeFileSync(join(outputDir, 'src/pages/index.astro'), page);
}

async function generateStyles(outputDir: string, analysis: AnalysisCache): Promise<void> {
  const globalCss = `@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  html {
    scroll-behavior: smooth;
  }
  
  body {
    @apply text-gray-900 bg-white;
  }
  
  * {
    @apply border-gray-200;
  }
}

@layer components {
  .container {
    @apply mx-auto max-w-7xl px-4 sm:px-6 lg:px-8;
  }
  
  .btn {
    @apply inline-flex items-center justify-center rounded-lg px-6 py-3 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none;
  }
  
  .btn-primary {
    @apply bg-primary-600 text-white hover:bg-primary-700 focus:ring-primary-500;
  }
  
  .btn-secondary {
    @apply bg-gray-100 text-gray-900 hover:bg-gray-200 focus:ring-gray-500;
  }
  
  .hero-section {
    @apply py-20 sm:py-32 lg:py-40;
  }
  
  .hero-title {
    @apply text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight;
  }
  
  .hero-subtitle {
    @apply mt-6 text-lg sm:text-xl text-gray-600 max-w-2xl;
  }
  
  .hero-ctas {
    @apply mt-8 flex flex-col sm:flex-row gap-4;
  }
  
  .content-section {
    @apply py-16 sm:py-24;
  }
  
  .site-footer {
    @apply py-12 border-t border-gray-200;
  }

  .site-header {
    @apply border-b border-gray-200 py-4;
  }

  .site-header .container {
    @apply flex items-center justify-between;
  }

  .site-brand {
    @apply text-lg font-bold;
  }

  .site-header nav {
    @apply flex gap-6 text-sm font-medium text-gray-600;
  }
}

@layer utilities {
  .text-balance {
    text-wrap: balance;
  }
}
`;
  writeFileSync(join(outputDir, 'src/styles/global.css'), globalCss);
}

async function copyAssets(outputDir: string, analysis: AnalysisCache): Promise<void> {
  // Copy any downloaded assets from cache
  const cachePath = join(__dirname, '../../.cache/site-cloner', analysis.meta.hash);
  const assetsDir = join(cachePath, 'assets');
  const publicDir = join(outputDir, 'public');
  
  if (existsSync(assetsDir)) {
    cpSync(assetsDir, publicDir, { recursive: true });
  }
}

async function generateReadme(outputDir: string, analysis: AnalysisCache): Promise<void> {
  const readme = renderTemplateFile('README.md.hbs', {
    sourceUrl: analysis.meta.url,
    date: new Date().toLocaleDateString('pt-BR'),
    componentsCount: analysis.componentMap.length,
    colorsCount: Object.keys(analysis.designTokens.colors).length,
  });
  writeFileSync(join(outputDir, 'README.md'), readme);
}

function renderTemplateFile(templateName: string, data: Record<string, any>): string {
  const templatePath = join(TEMPLATES_DIR, templateName);
  if (!existsSync(templatePath)) {
    return getDefaultTemplate(templateName, data);
  }
  
  const template = readFileSync(templatePath, 'utf-8');
  return Handlebars.compile(template)(data);
}

function getDefaultTemplate(name: string, data: Record<string, any>): string {
  const templates: Record<string, string> = {
    'package.json.hbs': `{
  "name": "${data.name || 'cloned-site'}",
  "type": "module",
  "version": "${data.version || '1.0.0'}",
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "astro": "astro"
  },
  "dependencies": {
    "astro": "^4.16.0"
  },
  "devDependencies": {
    "@astrojs/tailwind": "^5.1.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.4.0"
  }
}`,
    'astro.config.mjs.hbs': `import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  integrations: [tailwind()],
  output: 'static',
});`,
    'tsconfig.json.hbs': `{
  "extends": "astro/tsconfigs/strict",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  }
}`,
    'README.md.hbs': `# Projeto Clonado

Gerado automaticamente pelo **site-cloner** em ${data.date}.

## 📋 Informações

- **Fonte original:** [${data.sourceUrl}](${data.sourceUrl})
- **Componentes detectados:** ${data.componentsCount}
- **Cores extraídas:** ${data.colorsCount}

## 🚀 Como usar

\`\`\`bash
# Instalar dependências
npm install

# Desenvolvimento
npm run dev

# Build para produção
npm run build

# Preview do build
npm run preview
\`\`\`

## 🎨 Personalização

### Design Tokens
Os tokens de design estão em \`tailwind.config.ts\`:
- **Cores:** \`theme.extend.colors\`
- **Espaçamento:** \`theme.extend.spacing\`
- **Tipografia:** \`theme.extend.fontSize\`, \`fontFamily\`
- **Border Radius:** \`theme.extend.borderRadius\`
- **Sombras:** \`theme.extend.boxShadow\`

### Componentes
Componentes em \`src/components/\`:
- \`ui/\` - Componentes base (Button, Card, Section, etc.)
- Componentes mapeados da referência original

### Conteúdo
Edite \`src/pages/index.astro\` para alterar o conteúdo.
Use o mapeamento de conteúdo via CLI:
\`\`\`bash
site-cloner clone <url> --content-mapping '{"h1": "Meu Título"}'
\`\`\`

## 📊 Validação

Para re-validar o projeto:
\`\`\`bash
site-cloner validate ./output-dir
\`\`\`

Relatórios de validação ficam em \`validation-report.html\`.

## ⚠️ Notas

- Este é um clone visual - funcionalidades complexas (backend, auth, etc.) não são replicadas
- Fontes licenciadas podem precisar de substituição manual
- Animações JS complexas são convertidas para CSS quando possível
- Verifique acessibilidade antes de colocar em produção
`,
  };
  
  return templates[name] || '';
}