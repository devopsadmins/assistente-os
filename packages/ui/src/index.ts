// Public API of @assistente-os/ui. Populated as modules land.
export { cn } from "./lib/cn";

export {
  DERIVED_VAR_KEYS,
  InvalidBrandColorError,
  type BrandInput,
  type DerivedTheme,
  type DerivedVarKey,
  type Oklch,
} from "./theme/types";

export { deriveTheme, DEFAULT_DERIVED } from "./theme/derive";

export { ThemeProvider, useBrand, DEFAULT_BRAND_CONTEXT } from "./theme/context";

export { Button, buttonVariants, type ButtonProps } from "./components/button";

export { Label } from "./components/label";
export { Input } from "./components/input";
export { Textarea } from "./components/textarea";
export { Field, type FieldProps } from "./components/field";

export { Separator } from "./components/separator";
export { Skeleton } from "./components/skeleton";
export { Badge, badgeVariants, type BadgeProps } from "./components/badge";
export { Avatar, AvatarImage, AvatarFallback } from "./components/avatar";
export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "./components/card";

export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "./components/dialog";
export { Popover, PopoverTrigger, PopoverContent } from "./components/popover";
export { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from "./components/tooltip";
export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "./components/dropdown-menu";
export { Tabs, TabsList, TabsTrigger, TabsContent } from "./components/tabs";

export { Select, SelectValue, SelectTrigger, SelectContent, SelectItem } from "./components/select";
export { Switch } from "./components/switch";
export { Checkbox } from "./components/checkbox";
export { ScrollArea } from "./components/scroll-area";
export { Toaster } from "./components/toaster";
export { useToast, type ToastOptions } from "./hooks/use-toast";
export { CodeBlock, type CodeBlockProps } from "./components/code-block";
export { Markdown, type MarkdownProps } from "./components/markdown";
export { Citation, type CitationProps, type CitationSource } from "./components/citation";
export { Message, type MessageProps, type MessageRole } from "./components/message";
export { MessageList, type MessageListProps } from "./components/message-list";
