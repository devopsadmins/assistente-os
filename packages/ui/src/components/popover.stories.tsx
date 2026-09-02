import { Popover, PopoverTrigger, PopoverContent } from "./popover";
import { Button } from "./button";

export const Default = () => (
  <Popover>
    <PopoverTrigger asChild>
      <Button variant="secondary">Abrir</Button>
    </PopoverTrigger>
    <PopoverContent aria-label="Detalhes">Conteúdo flutuante do popover.</PopoverContent>
  </Popover>
);
