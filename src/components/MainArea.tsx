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
}

export function MainArea({ activeTabId, allTabs, onExit, onExitCode }: Props) {

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
          />
        ))}
      </div>
    </div>
  );
}

export type { TabEntry };
