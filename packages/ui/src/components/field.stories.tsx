import { Field } from "./field";
import { Input } from "./input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "./select";
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
// DS3: Field's cloneElement path can't reach into <Select> (its root is a
// context provider with no DOM node of its own) — the render-prop form
// hands the caller the computed ids to wire onto SelectTrigger directly.
export const WithSelect = () => (
  <Field label="Tier do modelo" htmlFor="model-tier" hint="afeta custo e latência">
    {({ labelId, controlId, describedBy, invalid }) => (
      <Select defaultValue="local">
        <SelectTrigger id={controlId} aria-labelledby={labelId} aria-describedby={describedBy} aria-invalid={invalid}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="local">local</SelectItem>
          <SelectItem value="zen">zen</SelectItem>
        </SelectContent>
      </Select>
    )}
  </Field>
);
export const WithSelectError = () => (
  <Field label="Tier do modelo" htmlFor="model-tier" error="selecione um tier">
    {({ labelId, controlId, describedBy, invalid }) => (
      <Select>
        <SelectTrigger id={controlId} aria-labelledby={labelId} aria-describedby={describedBy} aria-invalid={invalid}>
          <SelectValue placeholder="Escolha um tier" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="local">local</SelectItem>
          <SelectItem value="zen">zen</SelectItem>
        </SelectContent>
      </Select>
    )}
  </Field>
);
