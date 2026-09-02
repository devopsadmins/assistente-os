import { Toaster } from "./toaster";
import { Button } from "./button";
import { useToast } from "../hooks/use-toast";

function Demo() {
  const { toast } = useToast();
  return (
    <>
      <Button
        onClick={() =>
          toast({ title: "Upload falhou", description: "arquivo maior que o limite", variant: "destructive" })
        }
      >
        Disparar erro
      </Button>
      <Toaster />
    </>
  );
}

export const Default = () => <Demo />;
