import * as React from "react";
import { marked, type Token } from "marked";
import { cn } from "../lib/cn";
import { sanitizeHtml } from "../lib/sanitize";
import { CodeBlock } from "./code-block";

export interface MarkdownProps {
  source: string;
  className?: string;
}

const CITATION_MARKER = /\[\[(\d+)\]\]/g;

function renderCitationMarkers(html: string): string {
  return html.replace(CITATION_MARKER, (_match, index: string) => `<sup class="ds-citation-marker">${index}</sup>`);
}

function HtmlBlock({ html }: { html: string }) {
  const safe = sanitizeHtml(renderCitationMarkers(html));
  // eslint-disable-next-line react/no-danger -- sanitized via DOMPurify above
  return <div dangerouslySetInnerHTML={{ __html: safe }} />;
}

export function Markdown({ source, className }: MarkdownProps) {
  const tokens = React.useMemo(() => marked.lexer(source, { gfm: true }), [source]);

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
