import type { Story } from "@ladle/react";
import { CodeBlock } from "./code-block";

export const Default: Story = () => (
  <CodeBlock lang="ts" code={"function greet(name: string) {\n  return `Hello, ${name}!`;\n}"} />
);

export const NoLanguage: Story = () => <CodeBlock code="plain text without a language tag" />;
