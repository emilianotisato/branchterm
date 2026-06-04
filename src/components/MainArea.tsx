import { Terminal } from "./Terminal";

interface TabEntry {
  id: string;
  title: string;
  startupCommand?: string;
  autostart: boolean;
}

interface Props {
  activeTabId: string | null;
  allTabs: TabEntry[];
  onExit: (tabId: string) => void;
  onExitCode: (tabId: string, code: number) => void;
  onSwitchTab: (dir: "next" | "prev") => void;
  onOpenPalette: () => void;
  onOpenNewTabPicker: () => void;
  onOpenScratchpad: () => void;
}

export function MainArea({ activeTabId, allTabs, onExit, onExitCode, onSwitchTab, onOpenPalette, onOpenNewTabPicker, onOpenScratchpad }: Props) {

  if (allTabs.length === 0) {
    return (
      <div className="main-area">
        <div className="placeholder">Select a terminal in the sidebar</div>
      </div>
    );
  }

  return (
    <div className="main-area">
      <div className="terminal-area">
        {allTabs.map((tab) => (
          <Terminal
            key={tab.id}
            tabId={tab.id}
            active={activeTabId === tab.id}
            onExit={() => onExit(tab.id)}
            onExitCode={(code) => onExitCode(tab.id, code)}
            onSwitchTab={onSwitchTab}
            onOpenPalette={onOpenPalette}
            onOpenNewTabPicker={onOpenNewTabPicker}
            onOpenScratchpad={onOpenScratchpad}
          />
        ))}
      </div>
    </div>
  );
}

export type { TabEntry };
