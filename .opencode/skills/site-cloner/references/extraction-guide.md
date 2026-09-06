# Extraction Guide - Site Cloner

## Visão Geral
Este guia detalha como a skill analisa diferentes tipos de sites e extrai design tokens, componentes e interações.

---

## Tipos de Sites Suportados

### 1. Sites Estáticos (HTML/CSS/JS Vanilla)
- **Exemplos**: Landing pages, templates Bootstrap, sites institucionais
- **Extração**: Completa - todos tokens, componentes, screenshots
- **Playwright**: `waitUntil: 'networkidle'`

### 2. SPAs (React, Vue, Svelte, Next.js, Nuxt)
- **Exemplos**: Stripe, Vercel, dashboards, apps web
- **Extração**: DOM final renderizado (hydration completa)
- **Playwright**: `waitUntil: 'networkidle'` + `waitForLoadState('domcontentloaded')` + `document.fonts.ready` + 2s buffer
- **Limitações**: Estado inicial pode variar; não executa user journeys complexos

### 3. Sites com SSR (Next.js, Astro, Remix)
- **Exemplos**: Blogs, e-commerce, documentação
- **Extração**: HTML inicial + JS hydration
- **Playwright**: Aguarda hidratação completa

### 4. Sites com CMS (WordPress, Webflow, Framer)
- **Exemplos**: Blogs corporativos, portfolios
- **Extração**: Estrutura renderizada pelo servidor
- **Atenção**: Classes CSS podem ser hasheadas (ex: `.css-1x2y3z`)

---

## Pipeline de Extração

### Fase 1: Navegação e Carregamento
```typescript
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForLoadState('domcontentloaded');
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(2000); // Buffer para animações iniciais
```

### Fase 2: Bloqueio de Recursos Desnecessários
```typescript
await page.route('**/*', (route) => {
  const resourceType = route.request().resourceType();
  if (['font', 'media', 'websocket'].includes(resourceType)) {
    route.abort(); // Acelera carregamento
  } else {
    route.continue();
  }
});
```

### Fase 3: Extração de Design Tokens
**Fonte**: `window.getComputedStyle(element)` para todos elementos

**Tokens Extraídos**:
1. **Cores**: `color`, `background-color`, `border-color`, `outline-color`
2. **Tipografia**: `font-family`, `font-size`, `font-weight`, `line-height`
3. **Espaçamento**: `padding*`, `margin*`, `gap`, `row-gap`, `column-gap`
4. **Border Radius**: `border-radius`, `border-*-radius`
5. **Sombras**: `box-shadow`
6. **Transições**: `transition`, `transition-*`
7. **Z-Index**: `z-index`

**Normalização**:
- Cores → categorizadas (primary, secondary, neutral, accent, transparent)
- Tamanhos → convertidos para `rem` (base 16px)
- Valores duplicados → removidos
- Top N valores por categoria (cores: 20, spacing: 20, etc.)

### Fase 4: Mapeamento de Componentes

**Heurística de Identificação**:
```javascript
const COMPONENT_PATTERNS = [
  { pattern: /hero|banner|jumbotron/i, type: 'Hero' },
  { pattern: /nav|navbar|header|menu/i, type: 'Nav' },
  { pattern: /footer/i, type: 'Footer' },
  { pattern: /button|btn|cta/i, type: 'Button' },
  { pattern: /card|feature|pricing|plan/i, type: 'Card' },
  { pattern: /carousel|slider|swiper/i, type: 'Carousel' },
  { pattern: /accordion|collapse/i, type: 'Accordion' },
  { pattern: /tab|tablist/i, type: 'Tabs' },
  { pattern: /modal|dialog|popup/i, type: 'Modal' },
  { pattern: /dropdown|select/i, type: 'Dropdown' },
  { pattern: /form|input|textarea|select/i, type: 'Form' },
  { pattern: /countdown|timer/i, type: 'Countdown' },
  { pattern: /grid|container|wrapper/i, type: 'Grid' },
  { pattern: /section|block/i, type: 'Section' },
];
```

**Seletores Únicos**:
- Prioridade: `#id` > `.class1.class2` > `tag:nth-child(n)`
- Classes utilitárias ignoradas (Tailwind, Bootstrap utilities)
- Profundidade máxima: 4 níveis

**Props Extraídas**:
- `id`, `class`, `href` (links), `src` (images), `type` (buttons)

### Fase 5: Detecção de Interações

| Interação | Seletores | Config Extraída |
|-----------|-----------|-----------------|
| Carousel | `[class*="carousel"], [class*="slider"], [class*="swiper"], [data-carousel]` | hasNav, hasDots, autoplay |
| Modal | `[class*="modal"], [class*="dialog"], [role="dialog"], [data-modal]` | trigger, closeOnEscape |
| Countdown | `[class*="countdown"], [data-countdown], [id*="countdown"]` | targetDate, format |
| Accordion | `[class*="accordion"], [data-accordion], details` | multiple, defaultOpen |
| Tabs | `[class*="tab"], [role="tablist"], [data-tabs]` | defaultTab, orientation |
| Dropdown | `[class*="dropdown"], [class*="select"], [data-dropdown]` | trigger, placement |
| Form | `form` | validation, submitHandler |
| Smooth Scroll | `a[href^="#"]` | behavior, offset |

### Fase 6: Captura de Screenshots

**Viewports**:
```javascript
const VIEWPORTS = {
  mobile: { width: 375, height: 667 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1440, height: 900 },
};
```

**Tipos de Screenshot**:
1. **Full Page** - Página inteira (scroll capturado)
2. **Viewport** - Apenas área visível
3. **Componentes-chave** - Hero, Header, Footer, CTAs, Cards

**Nomenclatura**:
```
fullpage-{viewport}.png
viewport-{viewport}.png
{component-selector}-{index}.png
```

---

## Tratamento de Casos Especiais

### Fontes Licenciadas / Externas
```javascript
// Detecta @font-face e Google Fonts
const fonts = await page.evaluate(() => {
  const stylesheets = Array.from(document.styleSheets);
  const fontFaces = [];
  stylesheets.forEach(sheet => {
    try {
      Array.from(sheet.cssRules || []).forEach(rule => {
        if (rule.type === CSSRule.FONT_FACE_RULE) {
          fontFaces.push({
            family: rule.style.fontFamily,
            src: rule.style.src,
            weight: rule.style.fontWeight,
            style: rule.style.fontStyle,
          });
        }
      });
    } catch (e) {
      // Cross-origin stylesheet
    }
  });
  return fontFaces;
});
```

**Ação**: Extrai `font-family` → sugere Google Fonts similar + aviso no relatório

### Animações Complexas (GSAP, Framer Motion, ScrollTrigger)
```javascript
// Extrai @keyframes CSS
const keyframes = await page.evaluate(() => {
  const sheets = Array.from(document.styleSheets);
  const animations = [];
  sheets.forEach(sheet => {
    try {
      Array.from(sheet.cssRules || []).forEach(rule => {
        if (rule.type === CSSRule.KEYFRAMES_RULE) {
          animations.push({
            name: rule.name,
            keyframes: Array.from(rule.cssRules).map(kr => ({
              keyText: kr.keyText,
              styles: kr.style.cssText,
            })),
          });
        }
      });
    } catch (e) {}
  });
  return animations;
});
```

**Ação**: Converte para `@keyframes` Tailwind; JS animations → stubs comentados

### Shadow DOM
```javascript
// Playwright acessa automaticamente
const shadowContent = await page.evaluate(() => {
  const shadows = [];
  document.querySelectorAll('*').forEach(el => {
    if (el.shadowRoot) {
      shadows.push({
        host: el.tagName.toLowerCase() + (el.id ? '#' + el.id : ''),
        innerHTML: el.shadowRoot.innerHTML.slice(0, 1000),
      });
    }
  });
  return shadows;
});
```

### Iframes Cross-Origin
```javascript
// Screenshot separado (não comparado)
const iframes = await page.$$('iframe');
for (const iframe of iframes) {
  try {
    const frame = await iframe.contentFrame();
    if (frame) {
      await frame.waitForLoadState('domcontentloaded');
      const shot = await frame.screenshot({ type: 'png' });
      // Salva como referência separada
    }
  } catch (e) {
    // Cross-origin - ignora
  }
}
```

### Assets Externos (CDN, Imagens, Fontes)
```javascript
// Baixa assets para local
const assets = await page.evaluate(() => {
  const urls = new Set<string>();
  // Imagens
  document.querySelectorAll('img').forEach(img => urls.add(img.src));
  // Background images
  document.querySelectorAll('*').forEach(el => {
    const bg = getComputedStyle(el).backgroundImage;
    const match = bg.match(/url\(['"]?([^'"]+)['"]?\)/);
    if (match) urls.add(match[1]);
  });
  // Fonts
  document.querySelectorAll('link[rel="stylesheet"], link[rel="preload"]').forEach(l => urls.add(l.href));
  return Array.from(urls);
});

// Baixa e salva em public/assets/
// Reescreve URLs no HTML gerado
```

---

## Limitações Conhecidas

| Limitação | Impacto | Workaround |
|-----------|---------|------------|
| Estados autenticados | Não acessa áreas logadas | Fornecer cookies via flag `--cookies` |
| A/B testing | Captura apenas variação atual | Executar múltiplas vezes |
| Conteúdo dinâmico (API) | Dados mockados nos componentes | Substituir via `--content-mapping` |
| WebGL/Canvas | Não extrai conteúdo | Screenshot visual apenas |
| Web Components custom | Shadow DOM suportado, mas estilos isolados | Extrair estilos do shadowRoot |
| CSS-in-JS (styled-components, emotion) | Classes hasheadas | Usar `data-attributes` como fallback |
| Lazy loading extremo | Imagens abaixo do fold não carregadas | Scroll programático antes de screenshot |

---

## Dicas para Melhores Resultados

### Preparação do Site Referência
1. **Desabilite A/B tests** temporariamente
2. **Desative animações complexas** (`prefers-reduced-motion`)
3. **Carregue todo conteúdo** (scroll até o final)
4. **Use viewport desktop** como referência principal

### Pós-Extração
1. Revise `design-tokens.json` - remova ruído
2. Ajuste `tailwind.config.ts` - refine escalas de cor
3. Edite componentes em `src/components/` - refine estrutura
4. Atualize `src/pages/index.astro` - conteúdo real

### Validação
```bash
# Validação rápida (apenas visual)
site-cloner validate ./projeto --threshold 0.85

# Validação completa
site-cloner validate ./projeto --threshold 0.90
```

---

## Debugging

### Logs Verbosos
```bash
site-cloner clone <url> --verbose --force-fresh
```

### Inspecionar Cache
```bash
ls ~/.cache/site-cloner/
cat ~/.cache/site-cloner/<hash>/analysis.json
```

### Screenshots de Referência
```bash
open ~/.cache/site-cloner/<hash>/screenshots/
```

### Servidor de Preview Manual
```bash
cd ./projeto
npm run preview
# Abre em http://localhost:4321
```