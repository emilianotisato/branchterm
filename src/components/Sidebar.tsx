import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { NewTabModal, TabEntry } from "./NewTabModal";
import { FreqCommand } from "./CommandPicker";
import { TermState } from "../types";
import { ContextMenu } from "./ContextMenu";
import { MergeModal } from "./MergeModal";

interface BranchEntry {
  name: string;
  parentBranch: string;
  workspacePath: string;
  createdAt: string;
  tabs: TabEntry[];
}

interface AppState {
  projectPath: string;
  branches: BranchEntry[];
  mainTabs: TabEntry[];
}

interface Props {
  activeTabId: string | null;
  termStates: Record<string, TermState>;
  onSelectTab: (tabId: string) => void;
  onStateLoaded: (state: AppState) => void;
  onTabCreated: (branch: string, tab: TabEntry) => void;
  onTabClosed: (branch: string, tabId: string) => void;
  onTabRun: (tabId: string) => void;
  onBranchDeleted: (branch: string, tabIds: string[]) => void;
}

function TabRow({
  tab,
  active,
  canClose,
  termState,
  onSelect,
  onClose,
  onRun,
}: {
  tab: TabEntry;
  active: boolean;
  canClose: boolean;
  termState: TermState;
  onSelect: () => void;
  onClose: () => void;
  onRun: () => void;
}) {
  const showDot = termState !== "shell";
  const showRun = !!tab.startupCommand;

  return (
    <div
      className={`tab-row ${active ? "active" : ""}`}
      onClick={onSelect}
    >
      {showDot && <span className={`tab-dot tab-dot-${termState}`}>●</span>}
      <span className="tab-row-title">{tab.title}</span>
      {showRun && (
        <button
          className="btn-icon tab-row-run"
          title="Run command"
          onClick={(e) => {
            e.stopPropagation();
            onRun();
          }}
        >
          ▶
        </button>
      )}
      {canClose && (
        <button
          className="btn-icon tab-row-close"
          title="Close terminal"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          ✕
        </button>
      )}
    </div>
  );
}

function BranchSection({
  label,
  tabs,
  activeTabId,
  termStates,
  onSelectTab,
  onAddTab,
  onCloseTab,
  onRunTab,
  onDeleteBranch,
  onMergeBranch,
}: {
  label: React.ReactNode;
  tabs: TabEntry[];
  activeTabId: string | null;
  termStates: Record<string, TermState>;
  onSelectTab: (tabId: string) => void;
  onAddTab: () => void;
  onCloseTab: (tabId: string) => void;
  onRunTab: (tabId: string) => void;
  onDeleteBranch?: () => void;
  onMergeBranch?: () => void;
}) {
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);

  const ctxItems = [
    ...(onMergeBranch ? [{ label: "Merge into…", onClick: onMergeBranch }] : []),
    ...(onDeleteBranch ? [{ label: "Delete workspace", danger: true, onClick: onDeleteBranch }] : []),
  ];

  return (
    <div className="branch-section">
      <div className="branch-section-header">
        <span
          className="branch-section-name"
          title={typeof label === "string" ? label : undefined}
          onContextMenu={(e) => {
            if (ctxItems.length === 0) return;
            e.preventDefault();
            setCtxMenu({ x: e.clientX, y: e.clientY });
          }}
        >
          {label}
        </span>
        <button
          className="btn-icon"
          style={{ opacity: 1, fontSize: "14px" }}
          title="New terminal"
          onClick={(e) => {
            e.stopPropagation();
            onAddTab();
          }}
        >
          +
        </button>
      </div>
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxItems}
          onClose={() => setCtxMenu(null)}
        />
      )}
      {tabs.map((tab) => (
        <TabRow
          key={tab.id}
          tab={tab}
          active={activeTabId === tab.id}
          canClose={tabs.length > 1}
          termState={termStates[tab.id] ?? "shell"}
          onSelect={() => onSelectTab(tab.id)}
          onClose={() => onCloseTab(tab.id)}
          onRun={() => onRunTab(tab.id)}
        />
      ))}
    </div>
  );
}

function CommandsSection() {
  const [commands, setCommands] = useState<FreqCommand[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [cmdStr, setCmdStr] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    invoke<FreqCommand[]>("get_commands").then(setCommands).catch(console.error);
  }, []);

  async function handleAdd() {
    const l = label.trim();
    const c = cmdStr.trim();
    if (!l || !c) return;
    setSaving(true);
    try {
      const created = await invoke<FreqCommand>("save_command", { label: l, cmd: c });
      setCommands((prev) => [...prev, created]);
      setLabel("");
      setCmdStr("");
      setAdding(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    await invoke("delete_command", { id });
    setCommands((prev) => prev.filter((c) => c.id !== id));
  }

  return (
    <div className="commands-section">
      <div className="commands-header" onClick={() => setExpanded((v) => !v)}>
        <span>Commands{commands.length > 0 ? ` (${commands.length})` : ""}</span>
        <div className="commands-header-actions" onClick={(e) => e.stopPropagation()}>
          {expanded && (
            <button
              className="btn-icon"
              style={{ opacity: 1, fontSize: "14px" }}
              title="Add command"
              onClick={() => setAdding((v) => !v)}
            >
              +
            </button>
          )}
          <span className="commands-chevron">{expanded ? "▾" : "▸"}</span>
        </div>
      </div>

      {expanded && (
        <>
          {adding && (
            <div className="cmd-add-form">
              <input
                type="text"
                placeholder="label (e.g. Run tests)"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                disabled={saving}
              />
              <input
                type="text"
                placeholder="command (e.g. cargo test)"
                value={cmdStr}
                onChange={(e) => setCmdStr(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAdd();
                  if (e.key === "Escape") {
                    setAdding(false);
                    setLabel("");
                    setCmdStr("");
                  }
                }}
                disabled={saving}
              />
              <div className="form-actions">
                <button className="btn btn-primary" onClick={handleAdd} disabled={saving}>
                  {saving ? "…" : "Add"}
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    setAdding(false);
                    setLabel("");
                    setCmdStr("");
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {commands.length === 0 && !adding && (
            <div className="empty-state" style={{ fontSize: "11px", padding: "8px 14px" }}>
              No commands yet
            </div>
          )}
          {commands.map((c) => (
            <div key={c.id} className="cmd-item">
              <div className="cmd-item-info">
                <div className="cmd-item-label">{c.label}</div>
                <code className="cmd-item-cmd">{c.cmd}</code>
              </div>
              <button
                className="btn-icon"
                style={{ opacity: 1 }}
                title="Delete"
                onClick={() => handleDelete(c.id)}
              >
                ✕
              </button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

export function Sidebar({
  activeTabId,
  termStates,
  onSelectTab,
  onStateLoaded,
  onTabCreated,
  onTabClosed,
  onTabRun,
  onBranchDeleted,
}: Props) {
  const [appState, setAppState] = useState<AppState | null>(null);
  const [currentBranch, setCurrentBranch] = useState("main");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalBranch, setModalBranch] = useState<string | null>(null);
  const [mergeBranch, setMergeBranch] = useState<{ name: string; parentBranch: string } | null>(null);

  useEffect(() => {
    invoke<AppState>("get_state").then((s) => {
      setAppState(s);
      onStateLoaded(s);
    });
    const refreshBranch = () =>
      invoke<string>("get_current_branch").then(setCurrentBranch).catch(() => {});
    refreshBranch();
    const timer = setInterval(refreshBranch, 2000);
    return () => clearInterval(timer);
  }, []);

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    setLoading(true);
    setError(null);
    try {
      const info = await invoke<{ name: string; tabs: TabEntry[] }>("new_branch", { name });
      const s = await invoke<AppState>("get_state");
      setAppState(s);
      if (info.tabs.length > 0) {
        onTabCreated(name, info.tabs[0]);
      }
      setNewName("");
      setCreating(false);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  function handleTabCreated(branch: string, tab: TabEntry) {
    setAppState((prev) => {
      if (!prev) return prev;
      if (branch === "__main__") {
        return { ...prev, mainTabs: [...prev.mainTabs, tab] };
      }
      return {
        ...prev,
        branches: prev.branches.map((b) =>
          b.name === branch ? { ...b, tabs: [...b.tabs, tab] } : b
        ),
      };
    });
    onTabCreated(branch, tab);
    setModalBranch(null);
  }

  async function handleCloseTab(branch: string, tabId: string) {
    try {
      await invoke("close_tab", { branch, tabId });
      setAppState((prev) => {
        if (!prev) return prev;
        if (branch === "__main__") {
          return { ...prev, mainTabs: prev.mainTabs.filter((t) => t.id !== tabId) };
        }
        return {
          ...prev,
          branches: prev.branches.map((b) =>
            b.name === branch
              ? { ...b, tabs: b.tabs.filter((t) => t.id !== tabId) }
              : b
          ),
        };
      });
      onTabClosed(branch, tabId);
    } catch (e) {
      console.error(e);
    }
  }

  async function handleRunTab(tabId: string) {
    await invoke("run_tab_command", { tabId }).catch(console.error);
    onTabRun(tabId);
  }

  async function handleDeleteBranch(branchName: string, tabIds: string[]) {
    if (!window.confirm(`Delete branch "${branchName}"? This removes the workspace directory.`)) return;
    try {
      await invoke("delete_branch_state", { branch: branchName });
      setAppState((prev) => {
        if (!prev) return prev;
        return { ...prev, branches: prev.branches.filter((b) => b.name !== branchName) };
      });
      onBranchDeleted(branchName, tabIds);
    } catch (e) {
      console.error(e);
    }
  }

  if (!appState) return <div className="sidebar"></div>;

  return (
    <div className="sidebar">
      <div className="branches-list">
        <BranchSection
          label={<>⌂ {currentBranch} <span style={{ color: "var(--accent)", fontWeight: 400, opacity: 0.75 }}>· {appState.projectPath.split("/").pop() || appState.projectPath}</span></>}
          tabs={appState.mainTabs}
          activeTabId={activeTabId}
          termStates={termStates}
          onSelectTab={onSelectTab}
          onAddTab={() => setModalBranch("__main__")}
          onCloseTab={(tabId) => handleCloseTab("__main__", tabId)}
          onRunTab={handleRunTab}
          // no onDeleteBranch — main cannot be deleted
        />

        {appState.branches.map((b) => (
          <BranchSection
            key={b.name}
            label={b.name}
            tabs={b.tabs}
            activeTabId={activeTabId}
            termStates={termStates}
            onSelectTab={onSelectTab}
            onAddTab={() => setModalBranch(b.name)}
            onCloseTab={(tabId) => handleCloseTab(b.name, tabId)}
            onRunTab={handleRunTab}
            onDeleteBranch={() => handleDeleteBranch(b.name, b.tabs.map((t) => t.id))}
            onMergeBranch={() => setMergeBranch({ name: b.name, parentBranch: b.parentBranch })}
          />
        ))}

        {appState.branches.length === 0 && (
          <div className="empty-state">No branches yet</div>
        )}
      </div>

      <CommandsSection />

      {error && <div className="error-banner">{error}</div>}

      <div className="sidebar-footer">
        {creating ? (
          <div className="new-branch-form">
            <input
              type="text"
              placeholder="branch-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
                if (e.key === "Escape") {
                  setCreating(false);
                  setNewName("");
                  setError(null);
                }
              }}
              autoFocus
              disabled={loading}
            />
            <div className="form-actions">
              <button className="btn btn-primary" onClick={handleCreate} disabled={loading}>
                {loading ? "Creating…" : "Create"}
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setCreating(false);
                  setNewName("");
                  setError(null);
                }}
                disabled={loading}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            + New Branch
          </button>
        )}
      </div>

      {modalBranch && (
        <NewTabModal
          branch={modalBranch}
          onCreated={(tab) => handleTabCreated(modalBranch, tab)}
          onClose={() => setModalBranch(null)}
        />
      )}

      {mergeBranch && (
        <MergeModal
          branch={mergeBranch.name}
          parentBranch={mergeBranch.parentBranch}
          onClose={() => setMergeBranch(null)}
          onWorkspaceDeleted={(branchName) => {
            const tabIds = appState?.branches.find((b) => b.name === branchName)?.tabs.map((t) => t.id) ?? [];
            setAppState((prev) => prev ? { ...prev, branches: prev.branches.filter((b) => b.name !== branchName) } : prev);
            onBranchDeleted(branchName, tabIds);
            setMergeBranch(null);
          }}
        />
      )}
    </div>
  );
}

export type { BranchEntry, AppState };
