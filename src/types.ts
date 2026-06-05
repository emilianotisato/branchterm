export type TermState = "shell" | "idle" | "running" | "done" | "failed" | "crashed";

export interface Pane {
  id: string;
  activeTabId: string | null;
}

export interface PanedView {
  id: string;
  panes: Pane[];
  focusedPaneId: string | null;
  layout?: Record<string, number>;
}

export type ActiveView =
  | { type: "single"; tabId: string | null }
  | { type: "paned"; viewId: string };
