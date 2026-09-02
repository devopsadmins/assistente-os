import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "./dropdown-menu";
import { Button } from "./button";

export const Default = () => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="secondary">Ações</Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent>
      <DropdownMenuItem>Renomear</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem>Excluir</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
);
