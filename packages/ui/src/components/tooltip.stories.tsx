import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from "./tooltip";
import { Button } from "./button";

export const Default = () => (
  <TooltipProvider delayDuration={0}>
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="secondary">Passe o mouse</Button>
      </TooltipTrigger>
      <TooltipContent>Uma dica útil</TooltipContent>
    </Tooltip>
  </TooltipProvider>
);
