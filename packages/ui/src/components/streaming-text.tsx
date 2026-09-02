import * as React from "react";
import { cn } from "../lib/cn";
import { Markdown } from "./markdown";

export interface StreamingTextProps extends React.HTMLAttributes<HTMLDivElement> {
  chunks: string[];
}

export const StreamingText = React.forwardRef<HTMLDivElement, StreamingTextProps>(
  ({ chunks, className, ...props }, ref) => {
    const source = React.useMemo(() => chunks.join(""), [chunks]);
    return (
      <div ref={ref} className={cn("ds-streaming-text relative pr-3", className)} {...props}>
        <Markdown source={source} />
        <span
          aria-hidden="true"
          className="ds-streaming-caret absolute bottom-1 right-0 inline-block h-4 w-0.5 animate-pulse bg-current"
        />
      </div>
    );
  },
);
StreamingText.displayName = "StreamingText";
