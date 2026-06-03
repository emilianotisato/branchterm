import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Sidebar, AppState } from "./components/Sidebar";
import { MainArea, TabEntry } from "./components/MainArea";
import { Scratchpad } from "./components/Scratchpad";
import "./App.css";

export default function App() {
  const [scratchpadOpen, setScratchpadOpen] = useState(false);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [allTabs, setAllTabs] = useState<TabEntry[]>([]);

  function handleStateLoaded(state: AppState) {
    const tabs: TabEntry[] = [
      ...state.mainTabs,
      ...state.branches.flatMap((b) => b.tabs),
    ];
    setAllTabs(tabs);

    // Spawn PTY for every tab
    for (const tab of state.mainTabs) {
      invoke("spawn_tab", { branch: "__main__", tab_id: tab.id }).catch(console.error);
    }
    for (const branch of state.branches) {
      for (const tab of branch.tabs) {
        invoke("spawn_tab", { branch: branch.name, tab_id: tab.id }).catch(console.error);
      }
    }

    // Activate the first main tab
    if (state.mainTabs.length > 0) {
      setActiveTabId(state.mainTabs[0].id);
    }
  }

  function handleTabCreated(branch: string, tab: TabEntry) {
    setAllTabs((prev) => (prev.find((t) => t.id === tab.id) ? prev : [...prev, tab]));
    setActiveTabId(tab.id);
    // PTY is already spawned by new_tab command on the Rust side
    void branch;
  }

  function handleTabClosed(branch: string, tabId: string) {
    setAllTabs((prev) => prev.filter((t) => t.id !== tabId));
    if (activeTabId === tabId) {
      // Activate another tab in the same branch or any remaining tab
      setActiveTabId(allTabs.find((t) => t.id !== tabId)?.id ?? null);
    }
    void branch;
  }

  return (
    <div className="app">
      <Sidebar
        activeTabId={activeTabId}
        onSelectTab={setActiveTabId}
        onStateLoaded={handleStateLoaded}
        onTabCreated={handleTabCreated}
        onTabClosed={handleTabClosed}
      />
      <MainArea
        activeTabId={activeTabId}
        allTabs={allTabs}
      />
      <div className={`right-pane ${scratchpadOpen ? "open" : ""}`}>
        <button
          className="scratchpad-toggle"
          onClick={() => setScratchpadOpen((v) => !v)}
          title={scratchpadOpen ? "Collapse scratchpad" : "Expand scratchpad"}
        >
          {scratchpadOpen ? "›" : "‹"}
        </button>
        {scratchpadOpen && <Scratchpad />}
      </div>
    </div>
  );
}
