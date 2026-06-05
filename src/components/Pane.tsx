import type { Pane as PaneState } from "../types";
import type { TabEntry } from "./MainArea";

function formatBranchName(branch: string): string {
  return branch === "__main__" ? "main" : branch;
}

interface Props {
  pane: PaneState;
  focused: boolean;
  allTabs: TabEntry[];
  tabBranch: Record<string, string>;
  onFocus: () => void;
  terminalAreaRef: (el: HTMLDivElement | null) => void;
}

export function Pane({
  pane,
  focused,
  allTabs,
  tabBranch,
  onFocus,
  terminalAreaRef,
}: Props) {
  const activeTab = allTabs.find((t) => t.id === pane.activeTabId);
  const branch = pane.activeTabId ? tabBranch[pane.activeTabId] : undefined;
  const headerLabel =
    activeTab && branch
      ? `${activeTab.title} — ${formatBranchName(branch)}`
      : "No terminal selected";

  return (
    <div className="pane" onMouseDown={onFocus}>
      <div className={`pane-header ${focused ? "pane-header-focused" : ""}`}>
        <span className="pane-header-title">{headerLabel}</span>
      </div>
      <div className="pane-terminal-area" ref={terminalAreaRef}>
        {!pane.activeTabId && (
          <div className="placeholder">Select a terminal in the sidebar</div>
        )}
      </div>
    </div>
  );
}
