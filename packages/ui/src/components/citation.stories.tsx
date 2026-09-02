import type { Story } from "@ladle/react";
import { Citation } from "./citation";

export const WithLink: Story = () => (
  <p className="text-sm">
    Crescimento de receita no trimestre <Citation index={1} source={{ title: "Relatório Q3", url: "https://example.com/q3", snippet: "Crescimento de 12% ano a ano." }} />.
  </p>
);

export const WithoutLink: Story = () => (
  <p className="text-sm">
    Conforme registrado em ata <Citation index={2} source={{ title: "Ata da reunião de 2026-08-30" }} />.
  </p>
);
