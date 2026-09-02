import * as React from "react";
import { cn } from "../lib/cn";
import { Markdown } from "./markdown";

export interface StreamingTextProps extends React.HTMLAttributes<HTMLDivElement> {
  chunks: string[];
}

// `Markdown` wraps every top-level token in its own div (see `HtmlBlock` in
// markdown.tsx) — so `.ds-markdown`'s direct children are never the actual
// rendered block element (`<p>`, `<ul>`, `<table>`, ...) itself, always a
// one-off wrapper div around it. A `::after` attached to that wrapper (i.e.
// `.ds-markdown > *:last-child`) still starts a new anonymous line after it,
// because the wrapper's only child is itself block-level — reproducing the
// exact "caret on its own line" bug this is meant to fix, just one DOM level
// removed. Reaching past the wrapper (`> *:last-child` again) gets to the
// real element; lists, tables, and blockquotes need one level deeper still,
// to the actual leaf that carries the trailing inline text.
//
// These class names must stay as literal strings (not built at runtime via
// .map()/.join() on an array of selectors) — Tailwind's content scanner does
// a static text scan of source files for candidate class tokens, so a
// dynamically-assembled className is invisible to it and silently generates
// no CSS at all (verified: an earlier version of this file built the same
// selectors programmatically and every ::after came back `content: none` in
// the browser — no rule was ever emitted).
//
// `CodeBlock`'s own bordered card (rendered when the last token is a fenced
// code block) is deliberately not covered here — its content isn't prose to
// glue a text caret onto, and it's outside what this component's stories
// exercise.
const CARET_CLASSES = cn(
  // Paragraph or heading as the last block — leaf, inline content.
  "[&_.ds-markdown>*:last-child>:is(p,h1,h2,h3,h4,h5,h6):last-child]:after:ml-0.5",
  "[&_.ds-markdown>*:last-child>:is(p,h1,h2,h3,h4,h5,h6):last-child]:after:inline-block",
  "[&_.ds-markdown>*:last-child>:is(p,h1,h2,h3,h4,h5,h6):last-child]:after:h-4",
  "[&_.ds-markdown>*:last-child>:is(p,h1,h2,h3,h4,h5,h6):last-child]:after:w-0.5",
  "[&_.ds-markdown>*:last-child>:is(p,h1,h2,h3,h4,h5,h6):last-child]:after:animate-pulse",
  "[&_.ds-markdown>*:last-child>:is(p,h1,h2,h3,h4,h5,h6):last-child]:after:bg-current",
  "[&_.ds-markdown>*:last-child>:is(p,h1,h2,h3,h4,h5,h6):last-child]:after:align-text-bottom",
  "[&_.ds-markdown>*:last-child>:is(p,h1,h2,h3,h4,h5,h6):last-child]:after:content-['']",
  // List as the last block — the trailing text lives in its last <li>.
  "[&_.ds-markdown>*:last-child>:is(ul,ol):last-child_li:last-child]:after:ml-0.5",
  "[&_.ds-markdown>*:last-child>:is(ul,ol):last-child_li:last-child]:after:inline-block",
  "[&_.ds-markdown>*:last-child>:is(ul,ol):last-child_li:last-child]:after:h-4",
  "[&_.ds-markdown>*:last-child>:is(ul,ol):last-child_li:last-child]:after:w-0.5",
  "[&_.ds-markdown>*:last-child>:is(ul,ol):last-child_li:last-child]:after:animate-pulse",
  "[&_.ds-markdown>*:last-child>:is(ul,ol):last-child_li:last-child]:after:bg-current",
  "[&_.ds-markdown>*:last-child>:is(ul,ol):last-child_li:last-child]:after:align-text-bottom",
  "[&_.ds-markdown>*:last-child>:is(ul,ol):last-child_li:last-child]:after:content-['']",
  // Table as the last block — the trailing text lives in its last <td>.
  "[&_.ds-markdown>*:last-child>table:last-child_td:last-child]:after:ml-0.5",
  "[&_.ds-markdown>*:last-child>table:last-child_td:last-child]:after:inline-block",
  "[&_.ds-markdown>*:last-child>table:last-child_td:last-child]:after:h-4",
  "[&_.ds-markdown>*:last-child>table:last-child_td:last-child]:after:w-0.5",
  "[&_.ds-markdown>*:last-child>table:last-child_td:last-child]:after:animate-pulse",
  "[&_.ds-markdown>*:last-child>table:last-child_td:last-child]:after:bg-current",
  "[&_.ds-markdown>*:last-child>table:last-child_td:last-child]:after:align-text-bottom",
  "[&_.ds-markdown>*:last-child>table:last-child_td:last-child]:after:content-['']",
  // Blockquote as the last block — marked wraps its text in a <p>.
  "[&_.ds-markdown>*:last-child>blockquote:last-child_p:last-child]:after:ml-0.5",
  "[&_.ds-markdown>*:last-child>blockquote:last-child_p:last-child]:after:inline-block",
  "[&_.ds-markdown>*:last-child>blockquote:last-child_p:last-child]:after:h-4",
  "[&_.ds-markdown>*:last-child>blockquote:last-child_p:last-child]:after:w-0.5",
  "[&_.ds-markdown>*:last-child>blockquote:last-child_p:last-child]:after:animate-pulse",
  "[&_.ds-markdown>*:last-child>blockquote:last-child_p:last-child]:after:bg-current",
  "[&_.ds-markdown>*:last-child>blockquote:last-child_p:last-child]:after:align-text-bottom",
  "[&_.ds-markdown>*:last-child>blockquote:last-child_p:last-child]:after:content-['']",
  // Zero chunks yet: `.ds-markdown` renders with no children at all.
  "[&_.ds-markdown:empty]:after:ml-0.5",
  "[&_.ds-markdown:empty]:after:inline-block",
  "[&_.ds-markdown:empty]:after:h-4",
  "[&_.ds-markdown:empty]:after:w-0.5",
  "[&_.ds-markdown:empty]:after:animate-pulse",
  "[&_.ds-markdown:empty]:after:bg-current",
  "[&_.ds-markdown:empty]:after:align-text-bottom",
  "[&_.ds-markdown:empty]:after:content-['']",
);

export const StreamingText = React.forwardRef<HTMLDivElement, StreamingTextProps>(
  ({ chunks, className, ...props }, ref) => {
    const source = React.useMemo(() => chunks.join(""), [chunks]);
    return (
      <div ref={ref} className={cn("ds-streaming-text ds-streaming-caret", CARET_CLASSES, className)} {...props}>
        <Markdown source={source} />
      </div>
    );
  },
);
StreamingText.displayName = "StreamingText";
