import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FreqCommand } from "./CommandPicker";

interface BranchEntry {
  name: string;
  parentBranch: string;
  workspacePath: string;
  startupCommand?: string;
  createdAt: string;
}

interface AppState {
  projectPath: string;
  branches: BranchEntry[];
}

interface Props {
  activeBranch: string | null;
  onSelectBranch: (branch: string) => void;
  onBranchesChange?: (branches: BranchEntry[]) => void;
}

function BranchItem({
  branch,
  active,
  onSelect,
  onStartupSaved,
}: {
  branch: BranchEntry;
  active: boolean;
  onSelect: () => void;
  onStartupSaved: (name: string, cmd: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [cmd, setCmd] = useState(branch.startupCommand ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await invoke("set_startup_command", { branch: branch.name, cmd });
      onStartupSaved(branch.name, cmd);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`branch-item ${active ? "active" : ""}`}>
      <div className="branch-item-row" onClick={onSelect}>
        <span className="branch-name" title={branch.name}>
          {branch.name}
        </span>
        <button
          className="btn-icon"
          title="Set startup command"
          onClick={(e) => {
            e.stopPropagation();
            setEditing((v) => !v);
          }}
        >
          ⚙
        </button>
      </div>

      {branch.startupCommand && !editing && (
        <div className="startup-hint" title={branch.startupCommand}>
          ▶ {branch.startupCommand}
        </div>
      )}

      {editing && (
        <div className="startup-editor" onClick={(e) => e.stopPropagation()}>
          <input
            type="text"
            placeholder="e.g. claude"
            value={cmd}
            onChange={(e) => setCmd(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") setEditing(false);
            }}
            autoFocus
            disabled={saving}
          />
          <div className="form-actions">
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? "…" : "Save"}
            </button>
            <button className="btn btn-ghost" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
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
        <span>
          Commands{commands.length > 0 ? ` (${commands.length})` : ""}
        </span>
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

export function Sidebar({ activeBranch, onSelectBranch, onBranchesChange }: Props) {
  const [branches, setBranches] = useState<BranchEntry[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<AppState>("get_state").then((s) => {
      setBranches(s.branches);
      onBranchesChange?.(s.branches);
    });
  }, []);

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    setLoading(true);
    setError(null);
    try {
      await invoke("new_branch", { name });
      const s = await invoke<AppState>("get_state");
      setBranches(s.branches);
      onBranchesChange?.(s.branches);
      setNewName("");
      setCreating(false);
      onSelectBranch(name);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  function handleStartupSaved(name: string, cmd: string) {
    setBranches((prev) =>
      prev.map((b) => (b.name === name ? { ...b, startupCommand: cmd || undefined } : b))
    );
  }

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <span>branchterm</span>
      </div>

      <div className="branches-list">
        <div
          className={`branch-item branch-item--main ${activeBranch === "__main__" ? "active" : ""}`}
          onClick={() => onSelectBranch("__main__")}
        >
          <span className="branch-name" title="Project root terminal">
            ⌂ main
          </span>
        </div>

        {branches.length === 0 ? (
          <div className="empty-state">No branches yet</div>
        ) : (
          branches.map((b) => (
            <BranchItem
              key={b.name}
              branch={b}
              active={activeBranch === b.name}
              onSelect={() => onSelectBranch(b.name)}
              onStartupSaved={handleStartupSaved}
            />
          ))
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
    </div>
  );
}

export type { BranchEntry };
