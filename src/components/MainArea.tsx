import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Terminal } from "./Terminal";

interface Props {
  activeBranch: string | null;
  openBranches: string[];
  onSelectBranch: (branch: string) => void;
}

export function MainArea({ activeBranch, openBranches, onSelectBranch }: Props) {
  const spawnedRef = useRef<Set<string>>(new Set());

  // Spawn PTY whenever a branch is opened for the first time
  useEffect(() => {
    for (const branch of openBranches) {
      if (!spawnedRef.current.has(branch)) {
        spawnedRef.current.add(branch);
        if (branch === "__main__") {
          invoke("spawn_main_pty").catch(console.error);
        } else {
          invoke("spawn_pty", { branch }).catch(console.error);
        }
      }
    }
  }, [openBranches]);

  if (openBranches.length === 0) {
    return (
      <div className="main-area">
        <div className="placeholder">Select a branch to open a terminal</div>
      </div>
    );
  }

  return (
    <div className="main-area">
      <div className="tab-bar">
        {openBranches.map((branch) => (
          <div
            key={branch}
            className={`tab ${activeBranch === branch ? "active" : ""}`}
            onClick={() => onSelectBranch(branch)}
          >
            {branch === "__main__" ? "⌂ main" : branch}
          </div>
        ))}
      </div>
      <div className="terminal-area">
        {openBranches.map((branch) => (
          <Terminal
            key={branch}
            branchName={branch}
            active={activeBranch === branch}
          />
        ))}
      </div>
    </div>
  );
}
