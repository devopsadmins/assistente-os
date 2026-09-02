import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "./dialog";
import { Button } from "./button";

export const Default = () => (
  <Dialog>
    <DialogTrigger asChild>
      <Button>Abrir diálogo</Button>
    </DialogTrigger>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Confirmar</DialogTitle>
        <DialogDescription>Essa ação não pode ser desfeita.</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="secondary">Cancelar</Button>
        </DialogClose>
        <Button variant="destructive">Confirmar</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
