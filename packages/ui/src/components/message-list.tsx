import * as React from "react";
import { flushSync } from "react-dom";
import { ArrowDown } from "lucide-react";
import { cn } from "../lib/cn";
import { Button } from "./button";
import { ScrollArea } from "./scroll-area";

export interface MessageListProps extends React.HTMLAttributes<HTMLDivElement> {}

const BOTTOM_THRESHOLD_PX = 48;

export const MessageList = React.forwardRef<HTMLDivElement, MessageListProps>(
  ({ children, className, ...props }, ref) => {
    const viewportRef = React.useRef<HTMLDivElement>(null);
    const contentRef = React.useRef<HTMLDivElement>(null);
    const atBottomRef = React.useRef(true);
    const [atBottom, setAtBottom] = React.useState(true);

    const scrollToBottom = React.useCallback((moveFocus = false) => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      viewport.scrollTop = viewport.scrollHeight;
      if (moveFocus) viewport.focus();
      atBottomRef.current = true;
      setAtBottom(true);
    }, []);

    // Opening a thread lands on the newest turn, not the oldest.
    React.useEffect(() => {
      scrollToBottom();
      // Mount-only: intentionally does not re-run on scrollToBottom identity
      // changes (it's a stable useCallback with an empty dep array anyway).
    }, []);

    React.useEffect(() => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const handleScroll = () => {
        const distance = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
        const next = distance <= BOTTOM_THRESHOLD_PX;
        atBottomRef.current = next;
        // The scroll listener is attached directly to the DOM node (outside
        // React's synthetic event system), so a plain setState here is
        // batched onto a microtask by React 18+'s automatic batching — the
        // "jump to latest" button would pop in a tick after the scroll
        // event instead of with it. flushSync keeps the affordance in sync
        // with the actual scroll position, which is also what a reader
        // scrolling by hand expects to see with no visible delay.
        flushSync(() => setAtBottom(next));
      };
      viewport.addEventListener("scroll", handleScroll);
      return () => viewport.removeEventListener("scroll", handleScroll);
    }, []);

    React.useEffect(() => {
      const content = contentRef.current;
      if (!content) return;
      // MutationObserver covers the main target case (StreamingText
      // appending text as chunks arrive) and is exercisable in tests.
      // DS13: it doesn't catch pure reflow with no DOM mutation — a late-
      // loading avatar image or a web-font swap settling in — so a
      // ResizeObserver on the same content node is added belt-and-braces.
      // It's stubbed as a no-op in this repo's jsdom test setup
      // (vitest.setup.ts), so that half stays untested here (documented as
      // a test-environment gap, not a production one).
      const observer = new MutationObserver(() => {
        if (atBottomRef.current) scrollToBottom();
      });
      observer.observe(content, { childList: true, subtree: true, characterData: true });
      const resizeObserver = new ResizeObserver(() => {
        if (atBottomRef.current) scrollToBottom();
      });
      resizeObserver.observe(content);
      return () => {
        observer.disconnect();
        resizeObserver.disconnect();
      };
    }, [scrollToBottom]);

    return (
      <div ref={ref} className={cn("relative h-full min-h-0", className)} {...props}>
        <ScrollArea className="h-full" viewportRef={viewportRef}>
          {/* DS15: sem isto, leitor de tela nunca é avisado de mensagem nova
              chegando — role="log" + aria-live="polite" é o padrão ARIA pra
              região que recebe conteúdo anexado ao longo do tempo (chat,
              feed). Fica no container de conteúdo, não em cada bolha — uma
              StreamingText marcando aria-busy nesse meio tempo (ver
              streaming-text.tsx) evita que o leitor de tela tente anunciar
              cada fragmento parcial conforme chega. */}
          <div ref={contentRef} role="log" aria-live="polite" className="flex flex-col gap-4 p-4">
            {children}
          </div>
        </ScrollArea>
        {!atBottom ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="absolute bottom-4 left-1/2 -translate-x-1/2 gap-1.5 shadow-md"
            onClick={() => scrollToBottom(true)}
          >
            <ArrowDown className="h-3.5 w-3.5" />
            Ir para o final
          </Button>
        ) : null}
      </div>
    );
  },
);
MessageList.displayName = "MessageList";
