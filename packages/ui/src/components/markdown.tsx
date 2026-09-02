import * as React from "react";
import { marked, type Token, type TokenizerExtension, type RendererExtension } from "marked";
import { cn } from "../lib/cn";
import { sanitizeHtml } from "../lib/sanitize";
import { CodeBlock } from "./code-block";

export interface MarkdownProps {
  source: string;
  className?: string;
}

interface CitationMarkerToken {
  type: "citationMarker";
  raw: string;
  index: string;
}

const citationMarkerExtension: TokenizerExtension & RendererExtension = {
  name: "citationMarker",
  level: "inline",
  start(src) {
    return src.match(/\[\[\d+\]\]/)?.index;
  },
  tokenizer(src) {
    const match = /^\[\[(\d+)\]\]/.exec(src);
    if (!match) return undefined;
    // Under `noUncheckedIndexedAccess`, numeric indexing into a
    // RegExpExecArray types as `string | undefined` regardless of index. Both
    // non-null assertions below are safe: index 0 is always the full match on
    // a successful exec(), and group 1 is guaranteed because `(\d+)` is a
    // mandatory (non-optional) capture group in the pattern that just
    // matched.
    const token: CitationMarkerToken = { type: "citationMarker", raw: match[0]!, index: match[1]! };
    return token;
  },
  renderer(token) {
    const t = token as unknown as CitationMarkerToken;
    return `<sup class="ds-citation-marker">${t.index}</sup>`;
  },
};

marked.use({ extensions: [citationMarkerExtension] });

function HtmlBlock({ html }: { html: string }) {
  const safe = sanitizeHtml(html);
  return <div dangerouslySetInnerHTML={{ __html: safe }} />;
}

export function Markdown({ source, className }: MarkdownProps) {
  const tokens = React.useMemo(
    // Deliberately no explicit options object here: `marked.lexer(src, options)`
    // is `_Lexer.lex`, a *static* method whose constructor does
    // `this.options = options || exports.defaults` — passing a plain object
    // (even just `{ gfm: true }`) replaces the merged module defaults
    // wholesale, silently dropping the `citationMarker` extension registered
    // via `marked.use()` above (verified: with an explicit options object the
    // extension never fires). Omitting the argument falls through to
    // `exports.defaults`, which already carries `gfm: true` (marked's own
    // default) and the registered extensions.
    //
    // "space" tokens (blank lines between blocks) render as empty HTML via
    // marked's default renderer and would double the gap `space-y-3` already
    // adds between block children — drop them, the block spacing is already
    // handled by the wrapper's own layout.
    () => marked.lexer(source).filter((token) => token.type !== "space"),
    [source],
  );

  return (
    <div className={cn("ds-markdown space-y-3 text-sm text-foreground", className)}>
      {tokens.map((token: Token, index: number) =>
        token.type === "code" ? (
          <CodeBlock key={index} code={token.text} lang={token.lang || undefined} />
        ) : (
          <HtmlBlock key={index} html={marked.parser([token])} />
        ),
      )}
    </div>
  );
}
