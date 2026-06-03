import { Terminal } from "./Terminal";

interface TabEntry {
  id: string;
  title: string;
  startupCommand?: string;
}

interface Props {
  activeTabId: string | null;
  allTabs: TabEntry[];
}

export function MainArea({ activeTabId, allTabs }: Props) {

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
          />
        ))}
      </div>
    </div>
  );
}

export type { TabEntry };
