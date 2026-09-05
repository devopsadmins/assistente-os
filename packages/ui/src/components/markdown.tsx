import * as React from "react";
import { Marked, type Token, type TokenizerExtension, type RendererExtension } from "marked";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "../lib/cn";
import { sanitizeHtml } from "../lib/sanitize";
import { CodeBlock } from "./code-block";
import { CitationCardContent, type CitationSource } from "./citation";

export interface MarkdownProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onClick" | "onKeyDown"> {
  source: string;
  /**
   * Fontes indexadas por posição (`sources[0]` = citação `[[1]]`, etc.).
   * Sem esta prop (ou sem entrada pro índice pedido), `[[n]]` renderiza como
   * texto comum — não vira marcador de citação nenhum. Isso é a correção do
   * achado de spoofing da revisão do A2b-1: sem uma fonte real por trás,
   * `[[n]]` não deveria nem *parecer* clicável.
   */
  sources?: CitationSource[];
}

interface CitationMarkerToken {
  type: "citationMarker";
  raw: string;
  index: string;
}

/**
 * Uma instância própria do `Marked` por render (memoizada em `sources`) —
 * não o singleton default do módulo — porque a extensão precisa saber, no
 * momento do tokenize, se `[[n]]` tem uma fonte correspondente. O singleton
 * é compartilhado por todo consumidor do pacote `marked`; fechar sobre
 * `sources` ali vazaria estado entre renders/instâncias de `<Markdown>`.
 */
export function createMarkedInstance(hasSource: (index: number) => boolean): Marked {
  const instance = new Marked();
  const citationMarkerExtension: TokenizerExtension & RendererExtension = {
    name: "citationMarker",
    level: "inline",
    start(src) {
      return src.match(/\[\[\d+\]\]/)?.index;
    },
    tokenizer(src) {
      const match = /^\[\[(\d+)\]\]/.exec(src);
      if (!match) return undefined;
      // Sem fonte pro índice: não consome o token — `marked` trata `[[n]]`
      // como texto comum (mesmo resultado de antes desta feature existir).
      // Isso acontece ANTES de qualquer HTML ser gerado, não é um filtro
      // aplicado depois — spoofing por texto de usuário/LLM não tem como
      // produzir um marcador estilizado sem uma fonte real declarada.
      if (!hasSource(Number(match[1]))) return undefined;
      const token: CitationMarkerToken = { type: "citationMarker", raw: match[0]!, index: match[1]! };
      return token;
    },
    renderer(token) {
      const t = token as unknown as CitationMarkerToken;
      return `<sup class="ds-citation-marker" data-citation-index="${t.index}" role="button" tabindex="0" aria-label="Citação ${t.index}">${t.index}</sup>`;
    },
  };
  instance.use({ extensions: [citationMarkerExtension] });
  return instance;
}

function HtmlBlock({ html }: { html: string }) {
  const safe = sanitizeHtml(html);
  return <div dangerouslySetInnerHTML={{ __html: safe }} />;
}

// Tailwind's preflight reset strips the browser's default heading/list/table
// styling, and sanitized HTML mounted via dangerouslySetInnerHTML can't carry
// per-element React classNames — so typography is applied here as descendant
// selectors on the wrapper instead of a `prose` plugin (keeps this package's
// existing token-only-via-preset approach, no new dependency).
const MARKDOWN_TYPOGRAPHY = [
  "[&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:leading-tight",
  "[&_h2]:text-xl [&_h2]:font-semibold [&_h2]:leading-tight",
  "[&_h3]:text-lg [&_h3]:font-semibold",
  "[&_h4]:text-base [&_h4]:font-semibold",
  "[&_h5]:text-sm [&_h5]:font-semibold",
  "[&_h6]:text-sm [&_h6]:font-semibold [&_h6]:text-muted-foreground",
  "[&_p]:leading-relaxed",
  "[&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5",
  "[&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5",
  "[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-muted-foreground",
  "[&_a]:text-primary [&_a]:underline-offset-2 [&_a:hover]:underline",
  "[&_strong]:font-semibold",
  "[&_hr]:border-border",
  "[&_table]:w-full [&_table]:border-collapse [&_table]:text-sm",
  "[&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-medium",
  "[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1",
  // DS10: marcador de citação interativo — `[&_.ds-citation-marker]` porque
  // é HTML cru (dangerouslySetInnerHTML), não pode levar className do React.
  "[&_.ds-citation-marker]:inline-flex [&_.ds-citation-marker]:h-4 [&_.ds-citation-marker]:min-w-4 [&_.ds-citation-marker]:cursor-pointer",
  "[&_.ds-citation-marker]:items-center [&_.ds-citation-marker]:justify-center [&_.ds-citation-marker]:rounded-full [&_.ds-citation-marker]:bg-secondary",
  "[&_.ds-citation-marker]:px-1 [&_.ds-citation-marker]:text-[0.65em] [&_.ds-citation-marker]:font-medium [&_.ds-citation-marker]:text-secondary-foreground",
  "[&_.ds-citation-marker]:no-underline [&_.ds-citation-marker]:hover:bg-secondary/80",
  "[&_.ds-citation-marker]:focus-visible:outline-none [&_.ds-citation-marker]:focus-visible:ring-2 [&_.ds-citation-marker]:focus-visible:ring-ring",
].join(" ");

/** Objeto mínimo que o Popper do Radix aceita como âncora virtual — só precisa saber medir seu próprio retângulo. */
interface VirtualElement {
  getBoundingClientRect(): DOMRect;
}

const INERT_RECT: DOMRect = new DOMRect(0, 0, 0, 0);

/**
 * DS7: `onClick`/`onKeyDown` are deliberately excluded from the spread
 * (`MarkdownProps` omits them) rather than composed with a caller-supplied
 * handler — both drive the citation-marker click delegation below, and a
 * naive `{...props}` last would silently let a consumer's `onClick`
 * override marker clicks instead of running alongside them. Every other
 * DOM attribute (`id`, `data-testid`, `aria-*`, `style`, ...) passes through
 * normally via `{...props}`.
 */
export const Markdown = React.forwardRef<HTMLDivElement, MarkdownProps>(({ source, className, sources, ...props }, ref) => {
  const hasSource = React.useCallback((index: number) => Boolean(sources?.[index - 1]), [sources]);
  const marked = React.useMemo(() => createMarkedInstance(hasSource), [hasSource]);

  const tokens = React.useMemo(
    // Mesmo motivo do comentário original (agora na instância própria, não
    // no singleton): passar um options object substitui os defaults da
    // instância por inteiro, descartando a extensão registrada via `.use()`.
    //
    // "space" tokens (blank lines between blocks) render as empty HTML via
    // marked's default renderer and would double the gap `space-y-3` already
    // adds between block children — drop them, the block spacing is already
    // handled by the wrapper's own layout.
    () => marked.lexer(source).filter((token) => token.type !== "space"),
    [marked, source],
  );

  const [activeIndex, setActiveIndex] = React.useState<number | null>(null);
  const virtualRef = React.useRef<VirtualElement>({ getBoundingClientRect: () => INERT_RECT });

  const activateMarker = React.useCallback(
    (el: HTMLElement) => {
      const raw = el.getAttribute("data-citation-index");
      const index = raw ? Number(raw) : NaN;
      if (!Number.isFinite(index) || !hasSource(index)) return;
      virtualRef.current = { getBoundingClientRect: () => el.getBoundingClientRect() };
      setActiveIndex(index);
    },
    [hasSource],
  );

  // Delegação de evento: os marcadores vivem em HTML cru, não em elementos
  // React com onClick próprio — um único listener no wrapper cobre todos.
  const handleClick = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const marker = (event.target as HTMLElement).closest<HTMLElement>(".ds-citation-marker");
      if (marker) activateMarker(marker);
    },
    [activateMarker],
  );

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const marker = (event.target as HTMLElement).closest<HTMLElement>(".ds-citation-marker");
      if (marker) {
        event.preventDefault();
        activateMarker(marker);
      }
    },
    [activateMarker],
  );

  const activeSource = activeIndex != null ? sources?.[activeIndex - 1] : undefined;

  return (
    <div
      ref={ref}
      className={cn("ds-markdown space-y-3 text-sm text-foreground", MARKDOWN_TYPOGRAPHY, className)}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      {...props}
    >
      {tokens.map((token: Token, index: number) =>
        token.type === "code" ? (
          <CodeBlock key={index} code={token.text} lang={token.lang || undefined} />
        ) : (
          <HtmlBlock key={index} html={marked.parser([token])} />
        ),
      )}
      {activeSource ? (
        <PopoverPrimitive.Root
          open
          onOpenChange={(open) => {
            if (!open) setActiveIndex(null);
          }}
        >
          <PopoverPrimitive.Anchor virtualRef={virtualRef} />
          <PopoverPrimitive.Portal>
            <PopoverPrimitive.Content
              aria-label={`Detalhe da citação ${activeIndex}`}
              sideOffset={4}
              className="z-50 w-64 space-y-1 rounded-md border border-border bg-popover p-4 text-popover-foreground shadow-md focus-visible:outline-none"
              onEscapeKeyDown={() => setActiveIndex(null)}
              onPointerDownOutside={() => setActiveIndex(null)}
            >
              <CitationCardContent source={activeSource} />
            </PopoverPrimitive.Content>
          </PopoverPrimitive.Portal>
        </PopoverPrimitive.Root>
      ) : null}
    </div>
  );
});
Markdown.displayName = "Markdown";
