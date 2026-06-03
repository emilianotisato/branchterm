import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Terminal } from "./Terminal";
import { CommandPicker, FreqCommand } from "./CommandPicker";

interface Props {
  activeBranch: string | null;
  openBranches: string[];
  onSelectBranch: (branch: string) => void;
}

export function MainArea({ activeBranch, openBranches, onSelectBranch }: Props) {
  const spawnedRef = useRef<Set<string>>(new Set());
  const [commands, setCommands] = useState<FreqCommand[]>([]);
  const [pickerBranch, setPickerBranch] = useState<string | null>(null);

  useEffect(() => {
    for (const branch of openBranches) {
      if (!spawnedRef.current.has(branch)) {
        spawnedRef.current.add(branch);
        if (branch === "__main__") {
          invoke("spawn_main_pty").catch(console.error);
        } else {
          invoke("spawn_pty", { branch }).catch(console.error);
          invoke<FreqCommand[]>("get_commands")
            .then((cmds) => {
              if (cmds.length > 0) {
                setCommands(cmds);
                setPickerBranch(branch);
              }
            })
            .catch(console.error);
        }
      }
    }
  }, [openBranches]);

  async function handlePick(cmd: string) {
    if (!pickerBranch) return;
    try {
      await invoke("pty_input", { branch: pickerBranch, data: cmd + "\n" });
    } catch (e) {
      console.error(e);
    }
    setPickerBranch(null);
  }

  const showPicker =
    pickerBranch !== null && pickerBranch === activeBranch && commands.length > 0;

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
        {showPicker && (
          <CommandPicker
            commands={commands}
            onPick={handlePick}
            onClose={() => setPickerBranch(null)}
          />
        )}
      </div>
    </div>
  );
}
