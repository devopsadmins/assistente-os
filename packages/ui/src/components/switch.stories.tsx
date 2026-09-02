import { Switch } from "./switch";
import { Label } from "./label";

export const Default = () => (
  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
    <Switch id="notifications" />
    <Label htmlFor="notifications">Notificações ativas</Label>
  </div>
);
