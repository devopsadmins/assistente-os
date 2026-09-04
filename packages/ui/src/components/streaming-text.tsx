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
  // List as the last block — the trailing text lives in its last <li>. Uses
  // a direct-child combinator (`>li:last-child`, not a descendant one) so a
  // nested sub-list inside that final <li> doesn't also match its own
  // innermost last <li> — `:last-child` is evaluated per-parent, not
  // globally, so a descendant selector here would match both.
  "[&_.ds-markdown>*:last-child>:is(ul,ol):last-child>li:last-child]:after:ml-0.5",
  "[&_.ds-markdown>*:last-child>:is(ul,ol):last-child>li:last-child]:after:inline-block",
  "[&_.ds-markdown>*:last-child>:is(ul,ol):last-child>li:last-child]:after:h-4",
  "[&_.ds-markdown>*:last-child>:is(ul,ol):last-child>li:last-child]:after:w-0.5",
  "[&_.ds-markdown>*:last-child>:is(ul,ol):last-child>li:last-child]:after:animate-pulse",
  "[&_.ds-markdown>*:last-child>:is(ul,ol):last-child>li:last-child]:after:bg-current",
  "[&_.ds-markdown>*:last-child>:is(ul,ol):last-child>li:last-child]:after:align-text-bottom",
  "[&_.ds-markdown>*:last-child>:is(ul,ol):last-child>li:last-child]:after:content-['']",
  // Table as the last block — the trailing text lives in the last <td> of
  // the last row of the body. `marked`'s GFM table renderer always wraps
  // body rows in their own <tbody>, separate from the header's <thead><tr>
  // — without the `tbody:last-child` step, `tr:last-child` would ALSO match
  // the header's single <tr> (trivially "last-child" of its own <thead>
  // parent), duplicating the caret into the header. `tr:last-child` alone
  // (without a tbody scope) would also match the last <td> of *every* row,
  // not just the table's true final row, since `:last-child` is evaluated
  // per-parent: each row's own last <td> independently satisfies
  // `td:last-child` relative to that row. Direct-child (`>`) between
  // `tr:last-child` and `td:last-child` since a <td> is always a direct
  // child of its <tr>.
  "[&_.ds-markdown>*:last-child>table:last-child_tbody:last-child>tr:last-child>td:last-child]:after:ml-0.5",
  "[&_.ds-markdown>*:last-child>table:last-child_tbody:last-child>tr:last-child>td:last-child]:after:inline-block",
  "[&_.ds-markdown>*:last-child>table:last-child_tbody:last-child>tr:last-child>td:last-child]:after:h-4",
  "[&_.ds-markdown>*:last-child>table:last-child_tbody:last-child>tr:last-child>td:last-child]:after:w-0.5",
  "[&_.ds-markdown>*:last-child>table:last-child_tbody:last-child>tr:last-child>td:last-child]:after:animate-pulse",
  "[&_.ds-markdown>*:last-child>table:last-child_tbody:last-child>tr:last-child>td:last-child]:after:bg-current",
  "[&_.ds-markdown>*:last-child>table:last-child_tbody:last-child>tr:last-child>td:last-child]:after:align-text-bottom",
  "[&_.ds-markdown>*:last-child>table:last-child_tbody:last-child>tr:last-child>td:last-child]:after:content-['']",
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
