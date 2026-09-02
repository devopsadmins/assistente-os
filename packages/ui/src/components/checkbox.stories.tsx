import { Checkbox } from "./checkbox";
import { Label } from "./label";

export const Default = () => (
  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
    <Checkbox id="terms" />
    <Label htmlFor="terms">Aceito os termos</Label>
  </div>
);
