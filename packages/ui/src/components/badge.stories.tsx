import { Badge } from "./badge";

export const Variants = () => (
  <div style={{ display: "flex", gap: 8 }}>
    <Badge>default</Badge>
    <Badge variant="secondary">secondary</Badge>
    <Badge variant="destructive">destructive</Badge>
    <Badge variant="outline">outline</Badge>
  </div>
);
