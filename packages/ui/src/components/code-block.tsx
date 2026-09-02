import * as React from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "../lib/cn";
import { Button } from "./button";

export interface CodeBlockProps extends React.HTMLAttributes<HTMLDivElement> {
  code: string;
  lang?: string;
}

export const CodeBlock = React.forwardRef<HTMLDivElement, CodeBlockProps>(
  ({ code, lang, className, ...props }, ref) => {
    const [copied, setCopied] = React.useState(false);

    const handleCopy = React.useCallback(() => {
      navigator.clipboard.writeText(code).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      });
    }, [code]);

    return (
      <div
        ref={ref}
        className={cn("group relative overflow-hidden rounded-md border border-border bg-muted", className)}
        {...props}
      >
        <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
          <span className="text-xs text-muted-foreground">{lang ?? ""}</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2"
            aria-label="Copiar código"
            onClick={handleCopy}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </Button>
        </div>
        <pre className="overflow-x-auto p-3">
          <code className="font-mono text-sm text-foreground">{code}</code>
        </pre>
      </div>
    );
  },
);
CodeBlock.displayName = "CodeBlock";
