import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type MergeOutcome =
  | { type: "workspaceDirty" }
  | { type: "nothingToMerge" }
  | { type: "parentDrift"; current_branch: string }
  | { type: "conflict"; git_output: string }
  | { type: "success"; commits_merged: number; main_was_dirty: boolean };

type Mode =
  | { kind: "picker" }
  | { kind: "loading" }
  | { kind: "blocked"; message: string }
  | { kind: "mainDirtyWarn"; targetBranch: string; checkoutFirst: boolean; ignoreDrift: boolean }
  | { kind: "drift"; currentBranch: string; targetBranch: string }
  | { kind: "conflict"; gitOutput: string }
  | { kind: "success"; commitsMerged: number; targetBranch: string };

interface Props {
  branch: string;
  parentBranch: string;
  onClose: () => void;
  onWorkspaceDeleted: (branch: string) => void;
}

export function MergeModal({ branch, parentBranch, onClose, onWorkspaceDeleted }: Props) {
  const [mode, setMode] = useState<Mode>({ kind: "picker" });
  const [branches, setBranches] = useState<string[]>([]);
  const [selectedBranch, setSelectedBranch] = useState(parentBranch);
  const [deletingWorkspace, setDeletingWorkspace] = useState(false);

  useEffect(() => {
    invoke<string[]>("get_project_branches").then(setBranches).catch(console.error);
  }, []);

  async function doMerge(targetBranch: string, checkoutFirst: boolean, ignoreDrift: boolean) {
    setMode({ kind: "loading" });
    try {
      const result = await invoke<MergeOutcome>("merge_branch", {
        branch,
        targetBranch,
        checkoutFirst,
        ignoreDrift,
      });

      switch (result.type) {
        case "workspaceDirty":
          setMode({ kind: "blocked", message: "Workspace has uncommitted changes. Commit or stash them first." });
          break;
        case "nothingToMerge":
          setMode({ kind: "blocked", message: "No new commits in workspace to merge." });
          break;
        case "parentDrift":
          setMode({ kind: "drift", currentBranch: result.current_branch, targetBranch });
          break;
        case "conflict":
          setMode({ kind: "conflict", gitOutput: result.git_output });
          break;
        case "success":
          if (result.main_was_dirty) {
            // Show success but note the dirty main
          }
          setMode({ kind: "success", commitsMerged: result.commits_merged, targetBranch });
          break;
      }
    } catch (e) {
      setMode({ kind: "blocked", message: String(e) });
    }
  }

  async function handleDeleteWorkspace() {
    setDeletingWorkspace(true);
    try {
      await invoke("delete_branch_state", { branch });
      onWorkspaceDeleted(branch);
    } catch (e) {
      console.error(e);
    } finally {
      setDeletingWorkspace(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="modal-header">
          <span>
            {mode.kind === "picker" && `Merge "${branch}" into…`}
            {mode.kind === "loading" && "Merging…"}
            {mode.kind === "blocked" && "Cannot Merge"}
            {mode.kind === "mainDirtyWarn" && "Warning"}
            {mode.kind === "drift" && "Branch Mismatch"}
            {mode.kind === "conflict" && "Merge Conflict"}
            {mode.kind === "success" && "Merge Complete"}
          </span>
          <button className="btn-icon" style={{ opacity: 1 }} onClick={onClose}>✕</button>
        </div>

        {/* Picker */}
        {mode.kind === "picker" && (
          <div className="modal-body">
            <p className="modal-hint">Select a target branch (suggested: <strong>{parentBranch}</strong>)</p>
            <div className="modal-cmd-list">
              {branches.map((b) => (
                <div
                  key={b}
                  className={`modal-cmd-item${selectedBranch === b ? " selected" : ""}`}
                  onClick={() => setSelectedBranch(b)}
                >
                  <span className="modal-cmd-label">
                    {b === parentBranch ? `${b} (parent)` : b}
                  </span>
                </div>
              ))}
              {branches.length === 0 && (
                <div className="modal-empty">Loading branches…</div>
              )}
            </div>
            <div className="modal-footer" style={{ flexDirection: "row", justifyContent: "flex-end", gap: "8px" }}>
              <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button
                className="btn btn-primary"
                style={{ width: "auto" }}
                disabled={!selectedBranch || branches.length === 0}
                onClick={() => doMerge(selectedBranch, false, false)}
              >
                Merge into {selectedBranch}
              </button>
            </div>
          </div>
        )}

        {/* Loading */}
        {mode.kind === "loading" && (
          <div className="modal-body">
            <div className="modal-empty">Running git merge…</div>
          </div>
        )}

        {/* Blocked */}
        {mode.kind === "blocked" && (
          <div className="modal-body">
            <div className="merge-error-msg">{mode.message}</div>
            <div className="modal-footer" style={{ flexDirection: "row", justifyContent: "flex-end" }}>
              <button className="btn btn-ghost" onClick={onClose}>Close</button>
            </div>
          </div>
        )}

        {/* Drift */}
        {mode.kind === "drift" && (
          <div className="modal-body">
            <p className="modal-hint">
              Main project is on <strong>{mode.currentBranch}</strong>, but the target is <strong>{mode.targetBranch}</strong>.
            </p>
            <div className="merge-options">
              <button
                className="btn btn-primary"
                style={{ width: "100%" }}
                onClick={() => doMerge(mode.targetBranch, true, false)}
              >
                Checkout <code>{mode.targetBranch}</code> then merge
              </button>
              <button
                className="btn btn-ghost merge-option-btn"
                onClick={() => doMerge(mode.targetBranch, false, true)}
              >
                Merge onto <code>{mode.currentBranch}</code> anyway
              </button>
              <button className="btn btn-ghost merge-option-btn" onClick={onClose}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Conflict */}
        {mode.kind === "conflict" && (
          <div className="modal-body">
            <p className="modal-hint" style={{ color: "var(--danger)" }}>
              Merge failed — conflicts detected. Resolve them in the project terminal.
            </p>
            <pre className="merge-git-output">{mode.gitOutput}</pre>
            <div className="modal-footer" style={{ flexDirection: "row", justifyContent: "flex-end" }}>
              <button className="btn btn-ghost" onClick={onClose}>Dismiss</button>
            </div>
          </div>
        )}

        {/* Success */}
        {mode.kind === "success" && (
          <div className="modal-body">
            <div className="merge-success-msg">
              ✓ {mode.commitsMerged} commit{mode.commitsMerged !== 1 ? "s" : ""} merged into <strong>{mode.targetBranch}</strong>
            </div>
            <p style={{ marginTop: "12px" }}>Delete the branch workspace?</p>
            <div className="modal-footer" style={{ flexDirection: "row", justifyContent: "flex-end", gap: "8px" }}>
              <button className="btn btn-ghost" onClick={onClose} disabled={deletingWorkspace}>
                Keep workspace
              </button>
              <button
                className="btn btn-danger"
                style={{ width: "auto" }}
                onClick={handleDeleteWorkspace}
                disabled={deletingWorkspace}
              >
                {deletingWorkspace ? "Deleting…" : "Delete workspace"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
