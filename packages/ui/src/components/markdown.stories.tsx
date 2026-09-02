import type { Story } from "@ladle/react";
import { Markdown } from "./markdown";

const SAMPLE = `# Relatório

Um resumo com **destaque**, um [link](https://example.com) e uma citação [[1]].

- item um
- item dois

\`\`\`ts
function soma(a: number, b: number) {
  return a + b;
}
\`\`\`

| Métrica | Valor |
| --- | --- |
| Latência | 120ms |
`;

export const Default: Story = () => <Markdown source={SAMPLE} className="max-w-xl" />;
