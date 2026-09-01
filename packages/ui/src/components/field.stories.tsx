import { Field } from "./field";
import { Input } from "./input";
export const WithHint = () => (
  <Field label="E-mail" htmlFor="email" hint="usamos só pra login">
    <Input placeholder="voce@exemplo.com" />
  </Field>
);
export const WithError = () => (
  <Field label="Senha" htmlFor="pwd" error="senha muito curta">
    <Input type="password" />
  </Field>
);
