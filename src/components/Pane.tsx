import { Terminal } from "./Terminal";
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
  onExit: (tabId: string) => void;
  onExitCode: (tabId: string, code: number) => void;
}

export function Pane({
  pane,
  focused,
  allTabs,
  tabBranch,
  onFocus,
  onExit,
  onExitCode,
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
      <div className="pane-terminal-area">
        {allTabs.length === 0 ? (
          <div className="placeholder">Select a terminal in the sidebar</div>
        ) : (
          allTabs.map((tab) => (
            <Terminal
              key={tab.id}
              tabId={tab.id}
              active={pane.activeTabId === tab.id}
              onExit={() => onExit(tab.id)}
              onExitCode={(code) => onExitCode(tab.id, code)}
            />
          ))
        )}
      </div>
    </div>
  );
}
