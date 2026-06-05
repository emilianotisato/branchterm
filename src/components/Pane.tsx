import { useState } from "react";
import type { Pane as PaneState } from "../types";
import type { TabEntry } from "./MainArea";
import { ContextMenu } from "./ContextMenu";

function formatBranchName(branch: string): string {
  return branch === "__main__" ? "main" : branch;
}

interface Props {
  pane: PaneState;
  focused: boolean;
  allTabs: TabEntry[];
  tabBranch: Record<string, string>;
  canClose: boolean;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  onFocus: () => void;
  onClosePane: () => void;
  onMoveLeft: () => void;
  onMoveRight: () => void;
  terminalAreaRef: (el: HTMLDivElement | null) => void;
}

export function Pane({
  pane,
  focused,
  allTabs,
  tabBranch,
  canClose,
  canMoveLeft,
  canMoveRight,
  onFocus,
  onClosePane,
  onMoveLeft,
  onMoveRight,
  terminalAreaRef,
}: Props) {
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const activeTab = allTabs.find((t) => t.id === pane.activeTabId);
  const branch = pane.activeTabId ? tabBranch[pane.activeTabId] : undefined;
  const headerLabel =
    activeTab && branch
      ? `${activeTab.title} — ${formatBranchName(branch)}`
      : "No terminal selected";
  const showPaneMenu = canClose || canMoveLeft || canMoveRight;

  return (
    <div className="pane" onMouseDown={onFocus}>
      <div
        className={`pane-header ${focused ? "pane-header-focused" : ""}`}
        onContextMenu={
          showPaneMenu
            ? (e) => {
                e.preventDefault();
                e.stopPropagation();
                setCtxMenu({ x: e.clientX, y: e.clientY });
              }
            : undefined
        }
      >
        <span className="pane-header-title">{headerLabel}</span>
      </div>
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={[
            {
              label: "Move left",
              disabled: !canMoveLeft,
              onClick: onMoveLeft,
            },
            {
              label: "Move right",
              disabled: !canMoveRight,
              onClick: onMoveRight,
            },
            {
              label: "Close pane",
              disabled: !canClose,
              onClick: onClosePane,
            },
          ]}
          onClose={() => setCtxMenu(null)}
        />
      )}
      <div className="pane-terminal-area" ref={terminalAreaRef}>
        {!pane.activeTabId && (
          <div className="placeholder">Select a terminal in the sidebar</div>
        )}
      </div>
    </div>
  );
}
