import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Sidebar, AppState } from "./components/Sidebar";
import { PaneLayout } from "./components/PaneLayout";
import { TabEntry } from "./components/MainArea";
import { Scratchpad } from "./components/Scratchpad";
import { CommandPalette } from "./components/CommandPalette";
import { BranchPicker } from "./components/BranchPicker";
import { ShortcutsModal } from "./components/ShortcutsModal";
import { ExitConfirmModal } from "./components/ExitConfirmModal";
import { ActiveView, Pane, PanedView, TermState } from "./types";
import "./App.css";

const SINGLE_PANE_ID = "single-view-pane";

export default function App() {
  const [scratchpadOpen, setScratchpadOpen] = useState(false);
  const [scratchpadFocusCounter, setScratchpadFocusCounter] = useState(0);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [branchPickerOpen, setBranchPickerOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const [newTabBranch, setNewTabBranch] = useState<string | null>(null);
  const [tabRecency, setTabRecency] = useState<string[]>([]);
  const [tabBranch, setTabBranch] = useState<Record<string, string>>({});
  const [termStates, setTermStates] = useState<Record<string, TermState>>({});

  const [panedViews, setPanedViewsState] = useState<PanedView[]>([]);
  const panedViewsRef = useRef<PanedView[]>([]);
  const [activeView, setActiveViewState] = useState<ActiveView>({
    type: "single",
    tabId: null,
  });
  const activeViewRef = useRef<ActiveView>({ type: "single", tabId: null });

  const [allTabs, setAllTabsState] = useState<TabEntry[]>([]);
  const allTabsRef = useRef<TabEntry[]>([]);
  const bootSpawnedRef = useRef(false);

  function setPanedViews(views: PanedView[]) {
    panedViewsRef.current = views;
    setPanedViewsState(views);
  }

  function setActiveView(view: ActiveView) {
    activeViewRef.current = view;
    setActiveViewState(view);
  }

  function setAllTabs(tabs: TabEntry[]) {
    allTabsRef.current = tabs;
    setAllTabsState(tabs);
  }

  function findPanedViewForTab(
    tabId: string,
    views = panedViewsRef.current
  ): PanedView | undefined {
    return views.find((view) =>
      view.panes.some((pane) => pane.activeTabId === tabId)
    );
  }

  function getActivePanedView(
    views = panedViewsRef.current,
    view = activeViewRef.current
  ): PanedView | null {
    if (view.type !== "paned") return null;
    return views.find((panedView) => panedView.id === view.viewId) ?? null;
  }

  function getFocusedActiveTabId(): string | null {
    const view = activeViewRef.current;
    if (view.type === "single") return view.tabId;

    const panedView = getActivePanedView();
    if (!panedView) return null;
    const focusedPane = panedView.panes.find(
      (pane) => pane.id === panedView.focusedPaneId
    );
    return focusedPane?.activeTabId ?? panedView.panes[0]?.activeTabId ?? null;
  }

  function touchTabRecency(id: string) {
    setTabRecency((prev) => [id, ...prev.filter((r) => r !== id)]);
  }

  function navigateToTab(tabId: string) {
    const panedView = findPanedViewForTab(tabId);
    if (!panedView) {
      setActiveView({ type: "single", tabId });
      touchTabRecency(tabId);
      return;
    }

    const pane = panedView.panes.find((p) => p.activeTabId === tabId);
    setPanedViews(
      panedViewsRef.current.map((view) =>
        view.id === panedView.id
          ? { ...view, focusedPaneId: pane?.id ?? view.panes[0]?.id ?? null }
          : view
      )
    );
    setActiveView({ type: "paned", viewId: panedView.id });
    touchTabRecency(tabId);
  }

  function handleOpenInNewPane(tabId: string) {
    if (findPanedViewForTab(tabId)) return;

    const newPane: Pane = { id: crypto.randomUUID(), activeTabId: tabId };
    const currentView = activeViewRef.current;
    const currentPanedView = getActivePanedView();

    if (currentView.type === "paned" && currentPanedView) {
      setPanedViews(
        panedViewsRef.current.map((view) =>
          view.id === currentPanedView.id
            ? {
                ...view,
                panes: [...view.panes, newPane],
                focusedPaneId: newPane.id,
                layout: undefined,
              }
            : view
        )
      );
      setActiveView({ type: "paned", viewId: currentPanedView.id });
      touchTabRecency(tabId);
      return;
    }

    const currentTabId = getFocusedActiveTabId();
    if (!currentTabId || currentTabId === tabId) return;

    const firstPane: Pane = {
      id: crypto.randomUUID(),
      activeTabId: currentTabId,
    };
    const newView: PanedView = {
      id: crypto.randomUUID(),
      panes: [firstPane, newPane],
      focusedPaneId: newPane.id,
    };
    setPanedViews([...panedViewsRef.current, newView]);
    setActiveView({ type: "paned", viewId: newView.id });
    touchTabRecency(tabId);
  }

  // Reads from refs — safe to capture in xterm or window event handlers (never stale)
  function handleSwitchTab(dir: "next" | "prev") {
    const tabs = allTabsRef.current;
    const currentId = getFocusedActiveTabId();
    if (!currentId || tabs.length <= 1) return;

    const idx = tabs.findIndex((t) => t.id === currentId);
    if (idx === -1) return;

    const nextIdx =
      dir === "next"
        ? (idx + 1) % tabs.length
        : (idx - 1 + tabs.length) % tabs.length;
    navigateToTab(tabs[nextIdx].id);
  }

  const handleSwitchTabRef = useRef(handleSwitchTab);
  handleSwitchTabRef.current = handleSwitchTab;

  function handleOpenScratchpad() {
    setScratchpadOpen(true);
    setScratchpadFocusCounter((c) => c + 1);
  }

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWindow()
      .onCloseRequested((event) => {
        event.preventDefault();
        setExitConfirmOpen(true);
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(console.error);
    return () => {
      unlisten?.();
    };
  }, []);

  function handleConfirmExit() {
    setExitConfirmOpen(false);
    invoke("exit_app").catch(console.error);
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
          handleSwitchTabRef.current("next");
          break;
        case "BracketLeft":
          e.preventDefault();
          handleSwitchTabRef.current("prev");
          break;
        case "Backslash":
          e.preventDefault();
          setCommandPaletteOpen(true);
          break;
        case "KeyT":
          e.preventDefault();
          setBranchPickerOpen(true);
          break;
        case "KeyO":
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
    setTabRecency(tabs.map((t) => t.id));

    if (!bootSpawnedRef.current) {
      bootSpawnedRef.current = true;
      for (const tab of state.mainTabs) {
        invoke("spawn_tab", { branch: "__main__", tabId: tab.id }).catch(console.error);
      }
      for (const branch of state.branches) {
        for (const tab of branch.tabs) {
          invoke("spawn_tab", { branch: branch.name, tabId: tab.id }).catch(console.error);
        }
      }
    }

    const firstTabId = state.mainTabs[0]?.id ?? null;
    setActiveView({ type: "single", tabId: firstTabId });
  }

  function handleTabCreated(branch: string, tab: TabEntry) {
    if (!allTabsRef.current.find((t) => t.id === tab.id)) {
      setAllTabs([...allTabsRef.current, tab]);
    }
    setTermStates((prev) => ({ ...prev, [tab.id]: computeInitialState(tab) }));
    setTabBranch((prev) => ({ ...prev, [tab.id]: branch }));
    setActiveView({ type: "single", tabId: tab.id });
    touchTabRecency(tab.id);
    void branch;
  }

  function removeTabsFromPanedViews(
    removedTabIds: Set<string>,
    remainingTabs: TabEntry[]
  ) {
    const currentActive = activeViewRef.current;
    let nextActive = currentActive;
    const nextViews: PanedView[] = [];

    for (const view of panedViewsRef.current) {
      const panes = view.panes.filter(
        (pane) => !pane.activeTabId || !removedTabIds.has(pane.activeTabId)
      );

      if (panes.length >= 2) {
        const focusedPaneId = panes.some((pane) => pane.id === view.focusedPaneId)
          ? view.focusedPaneId
          : panes[0].id;
        nextViews.push({
          ...view,
          panes,
          focusedPaneId,
          layout: undefined,
        });
        continue;
      }

      if (currentActive.type === "paned" && currentActive.viewId === view.id) {
        nextActive = {
          type: "single",
          tabId: panes[0]?.activeTabId ?? remainingTabs[0]?.id ?? null,
        };
      }
    }

    if (
      currentActive.type === "single" &&
      currentActive.tabId &&
      removedTabIds.has(currentActive.tabId)
    ) {
      nextActive = { type: "single", tabId: remainingTabs[0]?.id ?? null };
    }

    if (nextActive.type === "paned") {
      const activeViewId = nextActive.viewId;
      if (!nextViews.some((view) => view.id === activeViewId)) {
        nextActive = { type: "single", tabId: remainingTabs[0]?.id ?? null };
      }
    }

    setPanedViews(nextViews);
    setActiveView(nextActive);
  }

  function handleTabClosed(branch: string, tabId: string) {
    const newTabs = allTabsRef.current.filter((t) => t.id !== tabId);
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
    setTabRecency((prev) => prev.filter((r) => r !== tabId));
    removeTabsFromPanedViews(new Set([tabId]), newTabs);
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
    const newTabs = allTabsRef.current.filter((t) => !idSet.has(t.id));
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
    setTabRecency((prev) => prev.filter((r) => !idSet.has(r)));
    removeTabsFromPanedViews(idSet, newTabs);
    void branch;
  }

  const activePanedView = getActivePanedView(panedViews, activeView);
  const panes: Pane[] = activePanedView
    ? activePanedView.panes
    : [
        {
          id: SINGLE_PANE_ID,
          activeTabId: activeView.type === "single" ? activeView.tabId : null,
        },
      ];
  const focusedPaneId = activePanedView
    ? activePanedView.focusedPaneId
    : SINGLE_PANE_ID;
  const activeTabId = activePanedView
    ? activePanedView.panes.find((pane) => pane.id === focusedPaneId)?.activeTabId ?? null
    : activeView.type === "single"
      ? activeView.tabId
      : null;
  const visiblePaneTabIds = panes
    .map((p) => p.activeTabId)
    .filter((id): id is string => id !== null);
  const panedViewTabIds = panedViews.flatMap((view) =>
    view.panes
      .map((pane) => pane.activeTabId)
      .filter((id): id is string => id !== null)
  );

  function handleFocusPane(paneId: string) {
    const currentPanedView = getActivePanedView();
    if (!currentPanedView) return;
    setPanedViews(
      panedViewsRef.current.map((view) =>
        view.id === currentPanedView.id
          ? { ...view, focusedPaneId: paneId }
          : view
      )
    );
  }

  function handlePanedLayoutChanged(layout: Record<string, number>) {
    const currentPanedView = getActivePanedView();
    if (!currentPanedView) return;
    setPanedViews(
      panedViewsRef.current.map((view) =>
        view.id === currentPanedView.id ? { ...view, layout } : view
      )
    );
  }

  function handleClosePane(paneId: string) {
    const currentPanedView = getActivePanedView();
    if (!currentPanedView || currentPanedView.panes.length <= 1) return;

    const remainingPanes = currentPanedView.panes.filter(
      (pane) => pane.id !== paneId
    );

    if (remainingPanes.length < 2) {
      const remainingTabId = remainingPanes[0]?.activeTabId ?? null;
      setPanedViews(
        panedViewsRef.current.filter((view) => view.id !== currentPanedView.id)
      );
      setActiveView({ type: "single", tabId: remainingTabId });
      return;
    }

    const focusedPaneId =
      currentPanedView.focusedPaneId === paneId
        ? remainingPanes[0].id
        : currentPanedView.focusedPaneId;

    setPanedViews(
      panedViewsRef.current.map((view) =>
        view.id === currentPanedView.id
          ? {
              ...view,
              panes: remainingPanes,
              focusedPaneId,
              layout: undefined,
            }
          : view
      )
    );
  }

  function handleMovePane(paneId: string, direction: "left" | "right") {
    const currentPanedView = getActivePanedView();
    if (!currentPanedView) return;

    const idx = currentPanedView.panes.findIndex((pane) => pane.id === paneId);
    if (idx === -1) return;
    const swapIdx = direction === "left" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= currentPanedView.panes.length) return;

    const nextPanes = [...currentPanedView.panes];
    [nextPanes[idx], nextPanes[swapIdx]] = [
      nextPanes[swapIdx],
      nextPanes[idx],
    ];

    setPanedViews(
      panedViewsRef.current.map((view) =>
        view.id === currentPanedView.id ? { ...view, panes: nextPanes } : view
      )
    );
  }

  // Unique branch names derived from tabBranch, __main__ first
  const availableBranches = [
    "__main__",
    ...[...new Set(Object.values(tabBranch).filter((b) => b !== "__main__"))],
  ];

  return (
    <div className="app">
      <Sidebar
        activeTabId={activeTabId}
        selectedTabId={null}
        visiblePaneTabIds={visiblePaneTabIds}
        panedViewTabIds={panedViewTabIds}
        termStates={termStates}
        onSelectTab={navigateToTab}
        onOpenInNewPane={handleOpenInNewPane}
        onStateLoaded={handleStateLoaded}
        onTabCreated={handleTabCreated}
        onTabClosed={handleTabClosed}
        onTabRun={handleTabRun}
        onBranchDeleted={handleBranchDeleted}
        externalModalBranch={newTabBranch}
        onExternalModalClose={() => setNewTabBranch(null)}
        onOpenShortcuts={() => setShortcutsOpen(true)}
      />
      <PaneLayout
        panes={panes}
        focusedPaneId={focusedPaneId}
        layout={activePanedView?.layout}
        panedViewActive={activeView.type === "paned"}
        allTabs={allTabs}
        tabBranch={tabBranch}
        onFocusPane={handleFocusPane}
        onClosePane={handleClosePane}
        onMovePaneLeft={(paneId) => handleMovePane(paneId, "left")}
        onMovePaneRight={(paneId) => handleMovePane(paneId, "right")}
        onLayoutChanged={handlePanedLayoutChanged}
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
        {scratchpadOpen && (
          <Scratchpad
            focusRequest={scratchpadFocusCounter}
            onCollapse={() => {
              setScratchpadOpen(false);
              window.dispatchEvent(new CustomEvent("branchterm:focus-terminal"));
            }}
          />
        )}
      </div>

      {commandPaletteOpen && (
        <CommandPalette
          allTabs={allTabs}
          tabRecency={tabRecency}
          tabBranch={tabBranch}
          currentTabId={activeTabId}
          onSelect={(tabId) => {
            navigateToTab(tabId);
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

      {exitConfirmOpen && (
        <ExitConfirmModal
          onConfirm={handleConfirmExit}
          onCancel={() => setExitConfirmOpen(false)}
        />
      )}
    </div>
  );
}
