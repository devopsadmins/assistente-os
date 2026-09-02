import { ScrollArea } from "./scroll-area";

export const Default = () => (
  <ScrollArea className="h-40 w-64 rounded-md border border-border p-4">
    {Array.from({ length: 30 }, (_, i) => (
      <p key={i}>linha {i + 1}</p>
    ))}
  </ScrollArea>
);
