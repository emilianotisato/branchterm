import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FreqCommand } from "./CommandPicker";

interface TabEntry {
  id: string;
  title: string;
  startupCommand?: string;
  autostart: boolean;
}

interface Props {
  branch: string;
  onCreated: (tab: TabEntry) => void;
  onClose: () => void;
}

type Mode = "pick" | "custom";

export function NewTabModal({ branch, onCreated, onClose }: Props) {
  const [mode, setMode] = useState<Mode>("pick");
  const [commands, setCommands] = useState<FreqCommand[]>([]);
  const [customCmd, setCustomCmd] = useState("");
  const [autostart, setAutostart] = useState(true);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    invoke<FreqCommand[]>("get_commands").then(setCommands).catch(console.error);
  }, []);

  async function createTab(command: string | null, title: string) {
    setLoading(true);
    try {
      const tab = await invoke<TabEntry>("new_tab", {
        branch,
        command: command ?? undefined,
        title,
        autostart: command ? autostart : true,
      });
      onCreated(tab);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  function handleCustomSubmit() {
    const cmd = customCmd.trim();
    if (!cmd) {
      createTab(null, "Shell");
    } else {
      createTab(cmd, cmd);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>New Terminal — {branch === "__main__" ? "main" : branch}</span>
          <button className="btn-icon" style={{ opacity: 1 }} onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="modal-tabs">
          <button
            className={`modal-tab ${mode === "pick" ? "active" : ""}`}
            onClick={() => setMode("pick")}
          >
            Global Commands
          </button>
          <button
            className={`modal-tab ${mode === "custom" ? "active" : ""}`}
            onClick={() => setMode("custom")}
          >
            Custom / Shell
          </button>
        </div>

        {mode === "pick" && (
          <div className="modal-body">
            {commands.length === 0 ? (
              <div className="modal-empty">
                No global commands saved yet. Add some in the Commands section.
              </div>
            ) : (
              <div className="modal-cmd-list">
                {commands.map((c) => (
                  <div
                    key={c.id}
                    className="modal-cmd-item"
                    onClick={() => !loading && createTab(c.cmd, c.label)}
                  >
                    <span className="modal-cmd-label">{c.label}</span>
                    <code className="modal-cmd-str">{c.cmd}</code>
                  </div>
                ))}
              </div>
            )}
            <div className="modal-footer">
              <label className="modal-autostart">
                <input
                  type="checkbox"
                  checked={autostart}
                  onChange={(e) => setAutostart(e.target.checked)}
                />
                Auto-start on open
              </label>
              <button
                className="btn btn-ghost"
                onClick={() => createTab(null, "Shell")}
                disabled={loading}
              >
                Open plain shell instead
              </button>
            </div>
          </div>
        )}

        {mode === "custom" && (
          <div className="modal-body">
            <p className="modal-hint">
              Enter a command to run automatically, or leave blank for a plain shell.
            </p>
            <input
              type="text"
              placeholder="e.g. claude, npm run dev, lazygit"
              value={customCmd}
              onChange={(e) => setCustomCmd(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCustomSubmit();
                if (e.key === "Escape") onClose();
              }}
              autoFocus
              disabled={loading}
            />
            {customCmd.trim() && (
              <label className="modal-autostart">
                <input
                  type="checkbox"
                  checked={autostart}
                  onChange={(e) => setAutostart(e.target.checked)}
                />
                Auto-start on open
              </label>
            )}
            <div className="form-actions" style={{ marginTop: "8px" }}>
              <button
                className="btn btn-primary"
                onClick={handleCustomSubmit}
                disabled={loading}
              >
                {loading ? "Opening…" : customCmd.trim() ? "Run & Open" : "Open Shell"}
              </button>
              <button className="btn btn-ghost" onClick={onClose}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export type { TabEntry };
