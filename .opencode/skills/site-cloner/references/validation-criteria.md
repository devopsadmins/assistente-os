# Critérios de Validação - Site Cloner

## Validação Visual (≥90% Similaridade)

### Metodologia
- **Pixelmatch**: Comparação pixel-a-pixel (50% do score)
- **SSIM (Structural Similarity)**: Similaridade perceptual (50% do score)
- **Score final**: Média ponderada dos dois métodos

### Thresholds Obrigatórios

| Componente | Threshold | Justificativa |
|------------|-----------|---------------|
| **Overall (Desktop Full-page)** | ≥ 0.90 (90%) | Qualidade geral perceptível |
| **Hero Section** | ≥ 0.95 (95%) | Primeira impressão crítica |
| **Header/Navigation** | ≥ 0.95 (95%) | Navegação deve ser idêntica |
| **Primary CTAs** | ≥ 0.93 (93%) | Botões de conversão |
| **Mobile Viewport** | ≥ 0.88 (88%) | Tolerância para responsividade |
| **Tablet Viewport** | ≥ 0.88 (88%) | Tolerância para responsividade |

### Viewports de Teste
1. **Mobile**: 375x667px (iPhone SE/8)
2. **Tablet**: 768x1024px (iPad)
3. **Desktop**: 1440x900px (Desktop HD)

### Captura de Screenshots
- Wait: `networkidle` + `domcontentloaded` + `document.fonts.ready` + 1000ms
- Viewports idênticas entre referência e gerado
- Scroll position: topo da página
- Full page + viewport-only + componentes-chave (hero, header, CTAs)

### Relatórios de Diff
- Heatmap visual (vermelho = diferença)
- Slider before/after interativo
- Score por componente
- Imagens de diff salvas em `visual-diffs/`

---

## Validação Funcional (100% Pass)

### Testes Obrigatórios (15 testes)

| # | Teste | Critério de Pass |
|---|-------|------------------|
| 1 | **Page Load** | Título presente, sem erros críticos |
| 2 | **Anchor Navigation** | Links `#` funcionam + scroll suave |
| 3 | **Smooth Scroll** | `scroll-behavior: smooth` no HTML |
| 4 | **Form Validation** | Campos `required` bloqueiam submit vazio |
| 5 | **CTA Buttons** | ≥1 botão visível e clicável |
| 6 | **Modal Open/Close** | Abre ao clicar trigger, fecha no ESC/close btn |
| 7 | **Carousel Navigation** | Next/Prev funcionam se carrossel existir |
| 8 | **Accordion Expand/Collapse** | Expande/colapsa ao clicar header |
| 9 | **Countdown Timer** | Atualiza a cada segundo se existir |
| 10 | **Mobile Responsive** | Sem scroll horizontal, font ≥14px |
| 11 | **Tablet Responsive** | Sem scroll horizontal |
| 12 | **Desktop Responsive** | Sem scroll horizontal |
| 13 | **Images Load** | ≥1 imagem carrega (naturalWidth > 0) |
| 14 | **Console Errors** | Zero erros críticos (exceto favicon/manifest) |
| 15 | **Basic Accessibility** | `lang` no HTML, alt em imagens |

### Critérios de Falha
- Qualquer teste funcional falha = validação funcional falha
- Erros de console não-críticos (warnings, favicon) são ignorados
- Screenshots de falha salvos automaticamente

---

## Loop de Correção (Máx 5 Iterações)

### Priorização de Gaps
1. **Funcionalidades falhando** (severidade 1.0)
2. **Visual: Hero/Header/CTAs** (thresholds rigorosos)
3. **Visual: Overall/Mobile/Tablet** (thresholds padrão)
4. **Componentes específicos** (< 85% similaridade)

### Estratégias de Correção Automática

#### Visual
- **Espaçamento**: Scale spacing tokens (±3-5%)
- **Cores**: Ajustar contraste/saturação de primárias/accent
- **Tipografia**: Ajustar font-size/line-height
- **Border radius**: Normalizar valores

#### Funcional
- **Smooth scroll**: Garantir `scroll-behavior: smooth` no CSS global
- **Forms**: Adicionar `required` + validação nativa HTML5
- **Modals**: Implementar focus trap + ESC close
- **Responsive**: Ajustar container max-width + breakpoints

### Limites de Correção Automática
- Máximo 5 iterações
- Se não convergir: relatório detalhado + sugestões manuais
- Não modifica estrutura HTML, apenas tokens/styles

---

## Cache e Reutilização

### Cache Key
`sha256(url + viewportConfig)` → 16 chars

### TTL
24 horas

### Armazenado
- `analysis.json` (tokens, components, interactions)
- `screenshots/` (baseline para comparação)
- `meta.json` (timestamp, url, viewport config)

### Invalidação
- `--force-fresh` ignora cache
- Mudança de viewport config invalida automaticamente

---

## Casos Edge e Limitações

| Cenário | Comportamento |
|---------|---------------|
| SPA (React/Vue/Next) | Playwright aguarda `networkidle`; extrai DOM final |
| Fontes licenciadas | Extrai `font-family`; avisa no relatório; usa Google Fonts fallback |
| Animações GSAP/ScrollTrigger | Extrai `@keyframes` CSS; JS animations → stubs comentados |
| Shadow DOM | Playwright pierce automático |
| Iframes cross-origin | Screenshot separado; não comparado |
| Assets externos (CDN) | Baixa para `public/` local; reescreve URLs |
| 90% inalcançável | Max 5 iterações → relatório gaps não automatizáveis |

---

## Validação Contínua (CI/CD)

```bash
# Pipeline recomendado
site-cloner clone https://referencia.com --output ./projeto
site-cloner validate ./projeto --threshold 0.90

# Em CI
- name: Clone & Validate
  run: |
    npx site-cloner clone $REF_URL --output ./site --force-fresh
    npx site-cloner validate ./site
```

---

## Métricas de Qualidade

| Métrica | Target | Ferramenta |
|---------|--------|------------|
| Visual Similarity | ≥ 90% | pixelmatch + SSIM |
| Functional Pass Rate | 100% | Playwright |
| Lighthouse Performance | ≥ 90 | Lighthouse CI |
| Lighthouse Accessibility | ≥ 95 | Lighthouse CI |
| Lighthouse Best Practices | ≥ 90 | Lighthouse CI |
| Lighthouse SEO | ≥ 90 | Lighthouse CI |
| Bundle Size (JS) | < 50KB | Astro build |
| Time to Interactive | < 3s | Lighthouse CI |