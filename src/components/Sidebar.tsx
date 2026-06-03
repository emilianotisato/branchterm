import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

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
          onClick={(e) => { e.stopPropagation(); setEditing((v) => !v); }}
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
      prev.map((b) => b.name === name ? { ...b, startupCommand: cmd || undefined } : b)
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
                if (e.key === "Escape") { setCreating(false); setNewName(""); setError(null); }
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
                onClick={() => { setCreating(false); setNewName(""); setError(null); }}
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
