import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./tabs";

function Example() {
  return (
    <Tabs defaultValue="login">
      <TabsList>
        <TabsTrigger value="login">Entrar</TabsTrigger>
        <TabsTrigger value="signup">Criar conta</TabsTrigger>
      </TabsList>
      <TabsContent value="login">form de login</TabsContent>
      <TabsContent value="signup">form de cadastro</TabsContent>
    </Tabs>
  );
}

test("shows the default tab's content and hides the other", () => {
  render(<Example />);
  expect(screen.getByText("form de login")).toBeInTheDocument();
  expect(screen.queryByText("form de cadastro")).not.toBeInTheDocument();
});

test("switches content on trigger click, and via ArrowLeft + Enter from the keyboard", async () => {
  const user = userEvent.setup();
  render(<Example />);
  await user.click(screen.getByRole("tab", { name: "Criar conta" }));
  expect(screen.getByText("form de cadastro")).toBeInTheDocument();
  expect(screen.queryByText("form de login")).not.toBeInTheDocument();

  screen.getByRole("tab", { name: "Criar conta" }).focus();
  await user.keyboard("{ArrowLeft}");
  expect(screen.getByRole("tab", { name: "Entrar" })).toHaveFocus();
});
