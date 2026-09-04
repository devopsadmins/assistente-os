export interface Thread {
  id: number;
  soul: string;
  accountId: number | null;
  title: string;
  createdAt: string;
  lastMessageAt: string;
}

export interface ThreadMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  ts: string;
}
