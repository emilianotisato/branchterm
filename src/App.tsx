import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Sidebar, AppState } from "./components/Sidebar";
import { MainArea, TabEntry } from "./components/MainArea";
import { Scratchpad } from "./components/Scratchpad";
import { CommandPalette } from "./components/CommandPalette";
import { BranchPicker } from "./components/BranchPicker";
import { ShortcutsModal } from "./components/ShortcutsModal";
import { TermState } from "./types";
import "./App.css";

export default function App() {
  const [scratchpadOpen, setScratchpadOpen] = useState(false);
  const [scratchpadFocusCounter, setScratchpadFocusCounter] = useState(0);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [branchPickerOpen, setBranchPickerOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [newTabBranch, setNewTabBranch] = useState<string | null>(null);
  const [tabRecency, setTabRecency] = useState<string[]>([]);
  const [tabBranch, setTabBranch] = useState<Record<string, string>>({});
  const [termStates, setTermStates] = useState<Record<string, TermState>>({});

  // State + refs in sync so handleSwitchTab (called from terminal event handlers) is never stale
  const [activeTabId, setActiveTabIdState] = useState<string | null>(null);
  const activeTabIdRef = useRef<string | null>(null);
  const [allTabs, setAllTabsState] = useState<TabEntry[]>([]);
  const allTabsRef = useRef<TabEntry[]>([]);

  function setActiveTabId(id: string | null) {
    activeTabIdRef.current = id;
    setActiveTabIdState(id);
  }

  function setAllTabs(tabs: TabEntry[]) {
    allTabsRef.current = tabs;
    setAllTabsState(tabs);
  }

  function activateTab(id: string) {
    activeTabIdRef.current = id;
    setActiveTabIdState(id);
    setTabRecency(prev => [id, ...prev.filter(r => r !== id)]);
  }

  // Reads from refs — safe to capture in xterm or window event handlers (never stale)
  function handleSwitchTab(dir: "next" | "prev") {
    const tabs = allTabsRef.current;
    const currentId = activeTabIdRef.current;
    if (!currentId || tabs.length <= 1) return;
    const idx = tabs.findIndex(t => t.id === currentId);
    if (idx === -1) return;
    const nextIdx = dir === "next"
      ? (idx + 1) % tabs.length
      : (idx - 1 + tabs.length) % tabs.length;
    activateTab(tabs[nextIdx].id);
  }

  function handleOpenScratchpad() {
    setScratchpadOpen(true);
    setScratchpadFocusCounter(c => c + 1);
  }

  // Global Ctrl+Shift shortcuts — fires regardless of which element has DOM focus,
  // including when a terminal has focus (xterm's customKeyEventHandler blocks the
  // keypress from reaching the PTY; this listener handles the actual UI action).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!e.ctrlKey || !e.shiftKey) return;
      switch (e.code) {
        case "BracketRight":
          e.preventDefault();
          handleSwitchTab("next");
          break;
        case "BracketLeft":
          e.preventDefault();
          handleSwitchTab("prev");
          break;
        case "KeyP":
          e.preventDefault();
          setCommandPaletteOpen(true);
          break;
        case "KeyT":
          e.preventDefault();
          setBranchPickerOpen(true);
          break;
        case "KeyS":
          e.preventDefault();
          handleOpenScratchpad();
          break;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    const branchMap: Record<string, string> = {};
    for (const tab of state.mainTabs) {
      initial[tab.id] = computeInitialState(tab);
      branchMap[tab.id] = "__main__";
    }
    for (const branch of state.branches) {
      for (const tab of branch.tabs) {
        initial[tab.id] = computeInitialState(tab);
        branchMap[tab.id] = branch.name;
      }
    }
    setTermStates(initial);
    setTabBranch(branchMap);
    setTabRecency(tabs.map(t => t.id));

    for (const tab of state.mainTabs) {
      invoke("spawn_tab", { branch: "__main__", tabId: tab.id }).catch(console.error);
    }
    for (const branch of state.branches) {
      for (const tab of branch.tabs) {
        invoke("spawn_tab", { branch: branch.name, tabId: tab.id }).catch(console.error);
      }
    }

    if (state.mainTabs.length > 0) {
      activateTab(state.mainTabs[0].id);
    }
  }

  function handleTabCreated(branch: string, tab: TabEntry) {
    if (!allTabsRef.current.find(t => t.id === tab.id)) {
      setAllTabs([...allTabsRef.current, tab]);
    }
    setTermStates((prev) => ({ ...prev, [tab.id]: computeInitialState(tab) }));
    setTabBranch((prev) => ({ ...prev, [tab.id]: branch }));
    activateTab(tab.id);
    void branch;
  }

  function handleTabClosed(branch: string, tabId: string) {
    const newTabs = allTabsRef.current.filter(t => t.id !== tabId);
    setAllTabs(newTabs);
    setTermStates((prev) => {
      const next = { ...prev };
      delete next[tabId];
      return next;
    });
    setTabBranch((prev) => {
      const next = { ...prev };
      delete next[tabId];
      return next;
    });
    setTabRecency((prev) => prev.filter(r => r !== tabId));
    if (activeTabIdRef.current === tabId) {
      const fallback = newTabs[0]?.id ?? null;
      if (fallback) activateTab(fallback);
      else setActiveTabId(null);
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
    const newTabs = allTabsRef.current.filter(t => !idSet.has(t.id));
    setAllTabs(newTabs);
    setTermStates((prev) => {
      const next = { ...prev };
      for (const id of tabIds) delete next[id];
      return next;
    });
    setTabBranch((prev) => {
      const next = { ...prev };
      for (const id of tabIds) delete next[id];
      return next;
    });
    setTabRecency((prev) => prev.filter(r => !idSet.has(r)));
    if (activeTabIdRef.current && idSet.has(activeTabIdRef.current)) {
      const fallback = newTabs[0]?.id ?? null;
      if (fallback) activateTab(fallback);
      else setActiveTabId(null);
    }
    void branch;
  }

  // Unique branch names derived from tabBranch, __main__ first
  const availableBranches = [
    "__main__",
    ...[...new Set(Object.values(tabBranch).filter(b => b !== "__main__"))],
  ];

  return (
    <div className="app">
      <Sidebar
        activeTabId={activeTabId}
        termStates={termStates}
        onSelectTab={activateTab}
        onStateLoaded={handleStateLoaded}
        onTabCreated={handleTabCreated}
        onTabClosed={handleTabClosed}
        onTabRun={handleTabRun}
        onBranchDeleted={handleBranchDeleted}
        externalModalBranch={newTabBranch}
        onExternalModalClose={() => setNewTabBranch(null)}
        onOpenShortcuts={() => setShortcutsOpen(true)}
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
        {scratchpadOpen && <Scratchpad focusRequest={scratchpadFocusCounter} />}
      </div>

      {commandPaletteOpen && (
        <CommandPalette
          allTabs={allTabs}
          tabRecency={tabRecency}
          tabBranch={tabBranch}
          currentTabId={activeTabId}
          onSelect={(tabId) => {
            activateTab(tabId);
            setCommandPaletteOpen(false);
          }}
          onClose={() => setCommandPaletteOpen(false)}
        />
      )}

      {branchPickerOpen && (
        <BranchPicker
          branches={availableBranches}
          onSelect={(branch) => {
            setBranchPickerOpen(false);
            setNewTabBranch(branch);
          }}
          onClose={() => setBranchPickerOpen(false)}
        />
      )}

      {shortcutsOpen && (
        <ShortcutsModal onClose={() => setShortcutsOpen(false)} />
      )}
    </div>
  );
}
