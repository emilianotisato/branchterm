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

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <span>branchterm</span>
      </div>

      <div className="branches-list">
        {branches.length === 0 ? (
          <div className="empty-state">No branches yet</div>
        ) : (
          branches.map((b) => (
            <div
              key={b.name}
              className={`branch-item ${activeBranch === b.name ? "active" : ""}`}
              onClick={() => onSelectBranch(b.name)}
            >
              <span className="branch-name" title={b.name}>
                {b.name}
              </span>
            </div>
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
