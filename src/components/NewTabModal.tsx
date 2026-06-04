import { useEffect, useRef, useState } from "react";
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
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [customCmd, setCustomCmd] = useState("");
  const [customName, setCustomName] = useState("");
  const [autostart, setAutostart] = useState(true);
  const [loading, setLoading] = useState(false);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    invoke<FreqCommand[]>("get_commands").then(setCommands).catch(console.error);
  }, []);

  useEffect(() => {
    setSelectedIndex(0);
  }, [commands, mode]);

  useEffect(() => {
    itemRefs.current[selectedIndex]?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  // focus name input when switching to custom mode
  useEffect(() => {
    if (mode === "custom") {
      setTimeout(() => nameInputRef.current?.focus(), 0);
    }
  }, [mode]);

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
    const name = customName.trim();
    if (!cmd) {
      createTab(null, name || "Shell");
    } else {
      createTab(cmd, name || cmd);
    }
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // don't intercept modifier combos (Ctrl+Shift+T etc.)
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (mode === "pick") {
        if (e.key === "ArrowDown") {
          e.preventDefault(); e.stopPropagation();
          setSelectedIndex((i) => Math.min(i + 1, commands.length - 1));
        } else if (e.key === "ArrowUp") {
          e.preventDefault(); e.stopPropagation();
          setSelectedIndex((i) => Math.max(i - 1, 0));
        } else if (e.key === "Enter") {
          e.preventDefault(); e.stopPropagation();
          const c = commands[selectedIndex];
          if (c && !loading) createTab(c.cmd, c.label);
        } else if (e.key === "Tab") {
          e.preventDefault(); e.stopPropagation();
          setMode("custom");
        } else if (e.key === "Escape") {
          e.preventDefault(); e.stopPropagation();
          onClose();
        }
      } else if (mode === "custom") {
        if (e.key === "Escape") {
          e.preventDefault(); e.stopPropagation();
          onClose();
        }
        // Tab/Enter/Shift+Tab handled by input onKeyDown handlers
      }
    }

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [mode, commands, selectedIndex, loading, onClose]);

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
            tabIndex={-1}
          >
            Global Commands
          </button>
          <button
            className={`modal-tab ${mode === "custom" ? "active" : ""}`}
            onClick={() => setMode("custom")}
            tabIndex={-1}
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
                {commands.map((c, i) => (
                  <div
                    key={c.id}
                    ref={(el) => { itemRefs.current[i] = el; }}
                    className={`modal-cmd-item${selectedIndex === i ? " selected" : ""}`}
                    onClick={() => !loading && createTab(c.cmd, c.label)}
                    onMouseEnter={() => setSelectedIndex(i)}
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
                  tabIndex={-1}
                />
                Auto-start on open
              </label>
              <button
                className="btn btn-ghost"
                onClick={() => createTab(null, "Shell")}
                disabled={loading}
                tabIndex={-1}
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
              ref={nameInputRef}
              type="text"
              placeholder="name (e.g. Dev Server)"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Tab" && e.shiftKey) {
                  e.preventDefault();
                  setMode("pick");
                }
              }}
              disabled={loading}
            />
            <input
              type="text"
              placeholder="command (e.g. claude, npm run dev, lazygit)"
              value={customCmd}
              onChange={(e) => setCustomCmd(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCustomSubmit();
              }}
              disabled={loading}
            />
            <label className="modal-autostart">
              <input
                type="checkbox"
                checked={autostart}
                onChange={(e) => setAutostart(e.target.checked)}
              />
              Auto-start on open
            </label>
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
