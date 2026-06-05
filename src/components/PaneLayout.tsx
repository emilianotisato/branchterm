import { Pane } from "./Pane";
import type { Pane as PaneState } from "../types";
import type { TabEntry } from "./MainArea";

interface Props {
  panes: PaneState[];
  focusedPaneId: string | null;
  allTabs: TabEntry[];
  tabBranch: Record<string, string>;
  onFocusPane: (paneId: string) => void;
  onExit: (tabId: string) => void;
  onExitCode: (tabId: string, code: number) => void;
}

export function PaneLayout({
  panes,
  focusedPaneId,
  allTabs,
  tabBranch,
  onFocusPane,
  onExit,
  onExitCode,
}: Props) {
  return (
    <div className="pane-layout">
      {panes.map((pane) => (
        <Pane
          key={pane.id}
          pane={pane}
          focused={pane.id === focusedPaneId}
          allTabs={allTabs}
          tabBranch={tabBranch}
          onFocus={() => onFocusPane(pane.id)}
          onExit={onExit}
          onExitCode={onExitCode}
        />
      ))}
    </div>
  );
}
