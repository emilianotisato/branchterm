import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Sidebar, AppState } from "./components/Sidebar";
import { MainArea, TabEntry } from "./components/MainArea";
import { Scratchpad } from "./components/Scratchpad";
import { TermState } from "./types";
import "./App.css";

export default function App() {
  const [scratchpadOpen, setScratchpadOpen] = useState(false);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [allTabs, setAllTabs] = useState<TabEntry[]>([]);
  const [termStates, setTermStates] = useState<Record<string, TermState>>({});

  function computeInitialState(tab: TabEntry): TermState {
    if (!tab.startupCommand) return "shell";
    return tab.autostart ? "running" : "idle";
  }

  function handleStateLoaded(state: AppState) {
    const tabs: TabEntry[] = [
      ...state.mainTabs,
      ...state.branches.flatMap((b) => b.tabs),
    ];
    setAllTabs(tabs);

    const initial: Record<string, TermState> = {};
    for (const tab of tabs) {
      initial[tab.id] = computeInitialState(tab);
    }
    setTermStates(initial);

    for (const tab of state.mainTabs) {
      invoke("spawn_tab", { branch: "__main__", tabId: tab.id }).catch(console.error);
    }
    for (const branch of state.branches) {
      for (const tab of branch.tabs) {
        invoke("spawn_tab", { branch: branch.name, tabId: tab.id }).catch(console.error);
      }
    }

    if (state.mainTabs.length > 0) {
      setActiveTabId(state.mainTabs[0].id);
    }
  }

  function handleTabCreated(branch: string, tab: TabEntry) {
    setAllTabs((prev) => (prev.find((t) => t.id === tab.id) ? prev : [...prev, tab]));
    setActiveTabId(tab.id);
    setTermStates((prev) => ({ ...prev, [tab.id]: computeInitialState(tab) }));
    void branch;
  }

  function handleTabClosed(branch: string, tabId: string) {
    setAllTabs((prev) => prev.filter((t) => t.id !== tabId));
    setTermStates((prev) => {
      const next = { ...prev };
      delete next[tabId];
      return next;
    });
    if (activeTabId === tabId) {
      setActiveTabId(allTabs.find((t) => t.id !== tabId)?.id ?? null);
    }
    void branch;
  }

  function handleTermEvent(tabId: string, event: "exit" | { exitCode: number }) {
    setTermStates((prev) => {
      const cur = prev[tabId] ?? "shell";
      if (event === "exit") return { ...prev, [tabId]: "crashed" };
      if (typeof event === "object") {
        // Update for any "active" state — allows ongoing tracking of manual commands.
        // Skip "shell" (no command ever), "idle" (not started yet), "crashed" (PTY dead).
        if (cur === "running" || cur === "done" || cur === "failed") {
          return { ...prev, [tabId]: event.exitCode === 0 ? "done" : "failed" };
        }
      }
      return prev;
    });
  }

  function handleTabRun(tabId: string) {
    setTermStates((prev) => ({ ...prev, [tabId]: "running" }));
  }

  function handleBranchDeleted(branch: string, tabIds: string[]) {
    const idSet = new Set(tabIds);
    setAllTabs((prev) => prev.filter((t) => !idSet.has(t.id)));
    setTermStates((prev) => {
      const next = { ...prev };
      for (const id of tabIds) delete next[id];
      return next;
    });
    if (activeTabId && idSet.has(activeTabId)) {
      setActiveTabId(allTabs.find((t) => !idSet.has(t.id))?.id ?? null);
    }
    void branch;
  }

  return (
    <div className="app">
      <Sidebar
        activeTabId={activeTabId}
        termStates={termStates}
        onSelectTab={setActiveTabId}
        onStateLoaded={handleStateLoaded}
        onTabCreated={handleTabCreated}
        onTabClosed={handleTabClosed}
        onTabRun={handleTabRun}
        onBranchDeleted={handleBranchDeleted}
      />
      <MainArea
        activeTabId={activeTabId}
        allTabs={allTabs}
        onExit={(tabId) => handleTermEvent(tabId, "exit")}
        onExitCode={(tabId, code) => handleTermEvent(tabId, { exitCode: code })}
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
