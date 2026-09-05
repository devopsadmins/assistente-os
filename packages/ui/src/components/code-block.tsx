import * as React from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "../lib/cn";
import { Button } from "./button";

export interface CodeBlockProps extends React.HTMLAttributes<HTMLDivElement> {
  code: string;
  lang?: string;
}

// DS10: `lang` vem de fora (o ```lang de um bloco de markdown, texto livre) —
// nem toda string é um id de linguagem reconhecido pelo shiki, e queremos
// aceitar aliases comuns que o `marked`/usuários digitam mas o shiki não
// reconhece como alias próprio (ex.: "js"/"ts" já são aliases do shiki; "sh"
// e "shell" também já são — a maioria comum já funciona sem mapeamento).
// `normalizeLang` só cuida do primeiro token (CodeBlock já corta em espaço
// pro badge) e força minúsculo, já que os ids do shiki são case-sensitive.
function normalizeLang(lang: string | undefined): string | undefined {
  const first = lang?.trim().split(/\s+/)[0]?.toLowerCase();
  return first || undefined;
}

// Import dinâmico (não top-level) — `shiki/bundle/web` carrega sob demanda só
// as gramáticas/temas pedidos (não bundla os ~50 idiomas do pacote de uma
// vez), mas o import do módulo em si ainda tem custo; adiar pro primeiro
// CodeBlock renderizado evita pagar esse custo em telas que nunca mostram
// código. Highlighter é cacheado (getSingletonHighlighter interno do shiki),
// então blocos seguintes não pagam o custo de novo.
let shikiModule: typeof import("shiki/bundle/web") | null = null;
async function getShiki(): Promise<typeof import("shiki/bundle/web")> {
  if (!shikiModule) shikiModule = await import("shiki/bundle/web");
  return shikiModule;
}

const SHIKI_THEME = "github-light";

export const CodeBlock = React.forwardRef<HTMLDivElement, CodeBlockProps>(
  ({ code, lang, className, ...props }, ref) => {
    const [copied, setCopied] = React.useState(false);
    // `undefined` = ainda carregando ou sem `lang`/`lang` desconhecido pro
    // shiki — nesses casos cai no <pre><code> monoespaçado sem cor de antes,
    // que já é um resultado válido, não um estado de erro visível.
    const [html, setHtml] = React.useState<string | undefined>(undefined);
    const normalizedLang = normalizeLang(lang);

    React.useEffect(() => {
      setHtml(undefined);
      if (!normalizedLang) return;
      let cancelled = false;
      getShiki()
        .then(({ codeToHtml, bundledLanguages }) => {
          if (cancelled) return;
          // Evita o roundtrip de uma Promise rejeitada pra idioma desconhecido
          // — bundledLanguages já é a lista estática de ids/aliases válidos.
          if (!(normalizedLang in bundledLanguages)) return;
          return codeToHtml(code, { lang: normalizedLang, theme: SHIKI_THEME }).then((result) => {
            if (!cancelled) setHtml(result);
          });
        })
        .catch(() => {
          // Highlight é estritamente cosmético — qualquer falha (idioma sem
          // gramática, erro de rede no import dinâmico) degrada pro
          // <pre><code> plano já existente, nunca quebra a renderização.
          if (!cancelled) setHtml(undefined);
        });
      return () => {
        cancelled = true;
      };
    }, [code, normalizedLang]);

    const handleCopy = React.useCallback(() => {
      if (!navigator.clipboard?.writeText) return;
      navigator.clipboard
        .writeText(code)
        .then(() => setCopied(true))
        .catch(() => {});
    }, [code]);

    React.useEffect(() => {
      if (!copied) return;
      const id = setTimeout(() => setCopied(false), 1500);
      return () => clearTimeout(id);
    }, [copied]);

    return (
      <div
        ref={ref}
        className={cn("group relative overflow-hidden rounded-md border border-border bg-muted", className)}
        {...props}
      >
        <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
          <span data-testid="code-block-lang" className="text-xs text-muted-foreground">
            {lang ? lang.split(/\s+/)[0] : ""}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2"
            aria-label="Copiar código"
            onClick={handleCopy}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </Button>
        </div>
        {html ? (
          // Saída do próprio shiki — o texto do código é escapado por ele
          // (mesma garantia de qualquer highlighter: o conteúdo vira spans de
          // token, não HTML arbitrário), não é `code`/`lang` externo sendo
          // interpretado como markup.
          <div
            data-testid="code-block-highlighted"
            className="overflow-x-auto p-3 text-sm [&_pre]:!bg-transparent [&_pre]:!p-0 [&_code]:font-mono"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <pre className="overflow-x-auto p-3">
            <code className="font-mono text-sm text-foreground">{code}</code>
          </pre>
        )}
      </div>
    );
  },
);
CodeBlock.displayName = "CodeBlock";
