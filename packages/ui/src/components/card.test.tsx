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
