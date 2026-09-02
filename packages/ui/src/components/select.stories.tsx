import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "./select";

export const Default = () => (
  <Select defaultValue="local">
    <SelectTrigger aria-label="Tier" style={{ width: 180 }}>
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="local">local</SelectItem>
      <SelectItem value="zen">zen</SelectItem>
      <SelectItem value="langgraph">langgraph</SelectItem>
    </SelectContent>
  </Select>
);
