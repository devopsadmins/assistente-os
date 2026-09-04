import { type FormEvent, useState } from "react";
import { Markdown, Message, MessageList, StreamingText } from "@assistente-os/ui";
import type { ApiClientConfig } from "../api/client";
import { useThreadStream } from "../hooks/useThreadStream";
import { useThreads } from "../hooks/useThreads";

export interface ThreadScreenProps {
  config: ApiClientConfig;
  soulId: string;
}

export function ThreadScreen({ config, soulId }: ThreadScreenProps) {
  const { threads, loading, error, activeThreadId, setActiveThreadId, createNewThread } = useThreads(config, soulId);
  const { messages, sending, send } = useThreadStream(config, soulId, activeThreadId);
  const [draft, setDraft] = useState("");

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const prompt = draft.trim();
    if (!prompt || sending) return;
    setDraft("");
    void send(prompt);
  };

  return (
    <div className="flex h-screen bg-background text-foreground">
      <aside className="flex w-64 shrink-0 flex-col gap-2 border-r border-border p-3">
        <button
          type="button"
          onClick={() => void createNewThread()}
          className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
        >
          + Nova thread
        </button>
        {loading ? <p className="text-sm text-muted-foreground">Carregando...</p> : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div className="flex flex-col gap-1 overflow-y-auto">
          {threads.map((thread) => (
            <button
              key={thread.id}
              type="button"
              onClick={() => setActiveThreadId(thread.id)}
              className={`rounded-md px-2 py-1.5 text-left text-sm ${
                thread.id === activeThreadId ? "bg-accent font-medium" : "hover:bg-accent/50"
              }`}
            >
              {thread.title || `Thread #${thread.id}`}
            </button>
          ))}
        </div>
      </aside>
      <main className="flex min-h-0 flex-1 flex-col">
        <MessageList className="flex-1">
          {messages.map((message) => {
            if (message.kind === "error") {
              return (
                <Message key={message.id} role="assistant">
                  <span className="text-destructive">{message.message}</span>
                </Message>
              );
            }
            if (message.kind === "streaming") {
              return (
                <Message key={message.id} role="assistant">
                  <StreamingText chunks={message.chunks} />
                </Message>
              );
            }
            return (
              <Message key={message.id} role={message.role}>
                <Markdown source={message.content} />
              </Message>
            );
          })}
        </MessageList>
        <form onSubmit={handleSubmit} className="flex gap-2 border-t border-border p-3">
          <input
            className="flex-1 rounded-md border border-input px-3 py-2 text-sm"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Escreva uma mensagem..."
            disabled={sending}
          />
          <button
            type="submit"
            disabled={sending || !draft.trim()}
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
          >
            Enviar
          </button>
        </form>
      </main>
    </div>
  );
}
