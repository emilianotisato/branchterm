export type TermState = "shell" | "idle" | "running" | "done" | "failed" | "crashed";

export interface Pane {
  id: string;
  activeTabId: string | null;
}
