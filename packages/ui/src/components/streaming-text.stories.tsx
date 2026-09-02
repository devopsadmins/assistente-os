import type { Story } from "@ladle/react";
import * as React from "react";
import { StreamingText } from "./streaming-text";

const DEMO_CHUNKS = [
  "Aqui está o que encontrei",
  ": a receita cresceu ",
  "**12%**",
  " no último trimestre",
  ".\n\n- Fonte: relatório interno\n- Período: Q3",
];

export const Default: Story = () => <StreamingText chunks={DEMO_CHUNKS} />;

export const Live: Story = () => {
  const [count, setCount] = React.useState(1);
  React.useEffect(() => {
    if (count >= DEMO_CHUNKS.length) return;
    const id = setTimeout(() => setCount((c) => c + 1), 500);
    return () => clearTimeout(id);
  }, [count]);
  return <StreamingText chunks={DEMO_CHUNKS.slice(0, count)} />;
};
