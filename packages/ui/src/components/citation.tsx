import * as React from "react";
import { cn } from "../lib/cn";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

export interface CitationSource {
  title: string;
  url?: string;
  snippet?: string;
}

export interface CitationProps {
  index: number;
  source: CitationSource;
  className?: string;
}

// Extraído pra ser reusado por `Markdown` — clique em `[[n]]` interativo abre
// o mesmo conteúdo, mas o Popover ali é montado com âncora virtual (o
// trigger não é um elemento React, é um `<sup>` dentro de HTML produzido via
// `dangerouslySetInnerHTML`), não com `PopoverTrigger`.
export function CitationCardContent({ source }: { source: CitationSource }) {
  return (
    <>
      {source.url ? (
        <a
          href={source.url}
          target="_blank"
          rel="noreferrer"
          className="text-sm font-medium text-primary underline-offset-2 hover:underline"
        >
          {source.title}
        </a>
      ) : (
        <p className="text-sm font-medium">{source.title}</p>
      )}
      {source.snippet ? <p className="text-xs text-muted-foreground">{source.snippet}</p> : null}
    </>
  );
}

export function Citation({ index, source, className }: CitationProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Citação ${index}`}
          className={cn(
            "inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-secondary px-1.5",
            "text-xs font-medium text-secondary-foreground",
            "hover:bg-secondary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
        >
          {index}
        </button>
      </PopoverTrigger>
      <PopoverContent aria-label={`Detalhe da citação ${index}`} className="w-64 space-y-1">
        <CitationCardContent source={source} />
      </PopoverContent>
    </Popover>
  );
}
