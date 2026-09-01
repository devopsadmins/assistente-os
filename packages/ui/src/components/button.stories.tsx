import { Button } from "./button";

export const Default = () => <Button>Enviar</Button>;
export const Variants = () => (
  <div style={{ display: "flex", gap: 8 }}>
    <Button variant="default">default</Button>
    <Button variant="secondary">secondary</Button>
    <Button variant="ghost">ghost</Button>
    <Button variant="destructive">destructive</Button>
    <Button variant="link">link</Button>
  </div>
);
export const Sizes = () => (
  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
    <Button size="sm">sm</Button>
    <Button size="md">md</Button>
    <Button size="lg">lg</Button>
  </div>
);
export const Disabled = () => <Button disabled>Desabilitado</Button>;
