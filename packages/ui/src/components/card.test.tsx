import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "./card";

test("composes header/content/footer with token classes", () => {
  render(
    <Card>
      <CardHeader>
        <CardTitle>Título</CardTitle>
        <CardDescription>Descrição</CardDescription>
      </CardHeader>
      <CardContent>Corpo</CardContent>
      <CardFooter>Rodapé</CardFooter>
    </Card>,
  );
  expect(screen.getByText("Título").tagName).toBe("H3");
  expect(screen.getByText("Corpo")).toBeInTheDocument();
  expect(screen.getByText("Descrição").className).toMatch(/text-muted-foreground\b/);
});

test("CardTitle asChild renders a different heading level while keeping its styling (DS7)", () => {
  render(<CardTitle asChild><h1>Título</h1></CardTitle>);
  const title = screen.getByText("Título");
  expect(title.tagName).toBe("H1");
  expect(title.className).toMatch(/text-lg\b/);
});
