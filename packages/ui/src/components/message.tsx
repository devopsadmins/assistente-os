import * as React from "react";
import { cn } from "../lib/cn";

export type MessageRole = "user" | "assistant";

export interface MessageProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "role"> {
  role: MessageRole;
  avatar?: React.ReactNode;
  footer?: React.ReactNode;
}

export const Message = React.forwardRef<HTMLDivElement, MessageProps>(
  ({ role, avatar, footer, children, className, ...props }, ref) => {
    const isUser = role === "user";
    return (
      <div
        ref={ref}
        data-role={role}
        className={cn("flex items-start gap-3", isUser && "flex-row-reverse", className)}
        {...props}
      >
        {avatar ? <div className="shrink-0">{avatar}</div> : null}
        <div className={cn("flex max-w-[80%] flex-col gap-1", isUser && "items-end")}>
          <div
            className={cn(
              "rounded-lg px-3 py-2 text-sm",
              isUser ? "bg-chat-user text-chat-user-foreground" : "bg-chat-assistant text-chat-assistant-foreground",
            )}
          >
            {children}
          </div>
          {footer ? <div className="flex items-center gap-2 text-xs text-muted-foreground">{footer}</div> : null}
        </div>
      </div>
    );
  },
);
Message.displayName = "Message";
