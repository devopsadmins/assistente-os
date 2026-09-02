import type { Story } from "@ladle/react";
import { Message } from "./message";
import { Avatar, AvatarFallback } from "./avatar";
import { Button } from "./button";
import { Citation } from "./citation";

export const AssistantDefault: Story = () => (
  <Message
    role="assistant"
    avatar={
      <Avatar>
        <AvatarFallback>A</AvatarFallback>
      </Avatar>
    }
  >
    Aqui está um resumo do que encontrei.
  </Message>
);

export const UserDefault: Story = () => (
  <Message
    role="user"
    avatar={
      <Avatar>
        <AvatarFallback>V</AvatarFallback>
      </Avatar>
    }
  >
    Pode me explicar melhor?
  </Message>
);

export const WithFooter: Story = () => (
  <Message
    role="assistant"
    avatar={
      <Avatar>
        <AvatarFallback>A</AvatarFallback>
      </Avatar>
    }
    footer={
      <>
        <Citation index={1} source={{ title: "Relatório Q3", url: "https://example.com" }} />
        <Button variant="ghost" size="sm" className="h-6 px-2">
          Copiar
        </Button>
      </>
    }
  >
    A receita cresceu 12% no trimestre.
  </Message>
);

export const LongContent: Story = () => (
  <Message
    role="assistant"
    avatar={
      <Avatar>
        <AvatarFallback>A</AvatarFallback>
      </Avatar>
    }
  >
    {"Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(20)}
  </Message>
);

export const WithoutAvatar: Story = () => <Message role="user">Sem avatar.</Message>;
