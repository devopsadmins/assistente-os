import type { Story } from "@ladle/react";
import { MessageList } from "./message-list";
import { Message } from "./message";

export const Default: Story = () => (
  <div style={{ height: 320 }}>
    <MessageList>
      <Message role="assistant">Como posso ajudar hoje?</Message>
      <Message role="user">Preciso de um resumo do relatório de vendas.</Message>
      <Message role="assistant">Claro — a receita cresceu 12% no trimestre.</Message>
    </MessageList>
  </div>
);

export const ManyMessagesOverflow: Story = () => (
  <div style={{ height: 320 }}>
    <MessageList>
      {Array.from({ length: 30 }, (_, i) => (
        <Message key={i} role={i % 2 === 0 ? "assistant" : "user"}>
          Mensagem número {i + 1}.
        </Message>
      ))}
    </MessageList>
  </div>
);
