import { useEffect, useMemo, useRef, useState } from "react";
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

type Step =
  | { type: "select" }
  | { type: "custom-name" }
  | { type: "custom-cmd" }
  | { type: "autostart"; command: string | null; title: string };

type ListItem =
  | { kind: "custom" }
  | { kind: "global"; id: string; label: string; cmd: string };

export function NewTabModal({ branch, onCreated, onClose }: Props) {
  const [commands, setCommands] = useState<FreqCommand[]>([]);
  const [step, setStep] = useState<Step>({ type: "select" });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [customName, setCustomName] = useState("");
  const [customCmd, setCustomCmd] = useState("");
  const [autostart, setAutostart] = useState(true);
  const [loading, setLoading] = useState(false);

  const nameInputRef = useRef<HTMLInputElement>(null);
  const cmdInputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  const items = useMemo<ListItem[]>(() => [
    { kind: "custom" },
    ...commands.map(c => ({ kind: "global" as const, id: c.id, label: c.label, cmd: c.cmd })),
  ], [commands]);

  useEffect(() => {
    invoke<FreqCommand[]>("get_commands").then(setCommands).catch(console.error);
  }, []);

  useEffect(() => {
    if (step.type === "custom-name") setTimeout(() => nameInputRef.current?.focus(), 0);
    else if (step.type === "custom-cmd") setTimeout(() => cmdInputRef.current?.focus(), 0);
  }, [step.type]);

  useEffect(() => {
    itemRefs.current[selectedIndex]?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  // ref snapshot so the window listener doesn't need to re-register on state changes
  const snap = useRef({ step, items, selectedIndex, autostart, loading });
  snap.current = { step, items, selectedIndex, autostart, loading };

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const branchRef = useRef(branch);
  branchRef.current = branch;

  const onCreatedRef = useRef(onCreated);
  onCreatedRef.current = onCreated;

  function goToAutostart(command: string | null, title: string) {
    setStep({ type: "autostart", command, title });
  }

  function advanceCustomName() {
    if (!customName.trim()) return;
    setStep({ type: "custom-cmd" });
  }

  function advanceCustomCmd() {
    const cmd = customCmd.trim();
    const name = customName.trim();
    goToAutostart(cmd || null, name);
  }

  async function doCreate(command: string | null, title: string, doAutostart: boolean) {
    if (snap.current.loading) return;
    setLoading(true);
    try {
      const tab = await invoke<TabEntry>("new_tab", {
        branch: branchRef.current,
        command: command ?? undefined,
        title,
        autostart: command ? doAutostart : true,
      });
      onCreatedRef.current(tab);
    } catch (e) {
      console.error(e);
      setLoading(false);
    }
  }

  // stable window-level capture listener (xterm eats events otherwise)
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const s = snap.current;

      if (s.step.type === "select") {
        if (e.key === "ArrowDown") {
          e.preventDefault(); e.stopPropagation();
          setSelectedIndex(i => Math.min(i + 1, s.items.length - 1));
        } else if (e.key === "ArrowUp") {
          e.preventDefault(); e.stopPropagation();
          setSelectedIndex(i => Math.max(i - 1, 0));
        } else if (e.key === "Enter") {
          e.preventDefault(); e.stopPropagation();
          const item = s.items[s.selectedIndex];
          if (!item) return;
          if (item.kind === "custom") {
            setStep({ type: "custom-name" });
          } else {
            setStep({ type: "autostart", command: item.cmd, title: item.label });
          }
        } else if (e.key === "Escape") {
          e.preventDefault(); e.stopPropagation();
          onCloseRef.current();
        }
      } else if (s.step.type === "autostart") {
        if (e.key === " ") {
          e.preventDefault(); e.stopPropagation();
          setAutostart(v => !v);
        } else if (e.key === "Enter" && !s.loading) {
          e.preventDefault(); e.stopPropagation();
          doCreate(s.step.command, s.step.title, s.autostart);
        } else if (e.key === "Escape") {
          e.preventDefault(); e.stopPropagation();
          onCloseRef.current();
        }
      }
    }

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const branchLabel = branch === "__main__" ? "main" : branch;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>New Terminal — {branchLabel}</span>
          <button className="btn-icon" style={{ opacity: 1 }} onClick={onClose}>✕</button>
        </div>

        {step.type === "select" && (
          <div className="modal-body">
            <div className="modal-cmd-list">
              {items.map((item, i) => (
                <div
                  key={item.kind === "custom" ? "__custom__" : item.id}
                  ref={el => { itemRefs.current[i] = el; }}
                  className={`modal-cmd-item${selectedIndex === i ? " selected" : ""}`}
                  onClick={() => {
                    if (item.kind === "custom") setStep({ type: "custom-name" });
                    else setStep({ type: "autostart", command: item.cmd, title: item.label });
                  }}
                  onMouseEnter={() => setSelectedIndex(i)}
                >
                  {item.kind === "custom" ? (
                    <>
                      <span className="modal-cmd-label">Custom / Shell</span>
                      <span className="modal-cmd-str">enter name + command or blank for shell</span>
                    </>
                  ) : (
                    <>
                      <span className="modal-cmd-label">{item.label}</span>
                      <code className="modal-cmd-str">{item.cmd}</code>
                    </>
                  )}
                </div>
              ))}
            </div>
            <p className="modal-hint">↑↓ navigate · Enter pick · Esc close</p>
          </div>
        )}

        {step.type === "custom-name" && (
          <div className="modal-body">
            <p className="modal-hint">Tab name</p>
            <input
              ref={nameInputRef}
              type="text"
              placeholder="e.g. Dev Server"
              value={customName}
              onChange={e => setCustomName(e.target.value)}
              onKeyDown={e => {
                if ((e.key === "Tab" || e.key === "Enter") && !e.shiftKey) {
                  e.preventDefault();
                  advanceCustomName();
                } else if (e.key === "Escape") {
                  onClose();
                }
              }}
              disabled={loading}
            />
            <p className="modal-hint">Tab / Enter → command · Esc close</p>
          </div>
        )}

        {step.type === "custom-cmd" && (
          <div className="modal-body">
            <p className="modal-hint">Command (leave blank for plain shell)</p>
            <input
              ref={cmdInputRef}
              type="text"
              placeholder="e.g. claude, npm run dev, lazygit"
              value={customCmd}
              onChange={e => setCustomCmd(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  advanceCustomCmd();
                } else if (e.key === "Tab" && e.shiftKey) {
                  e.preventDefault();
                  setStep({ type: "custom-name" });
                } else if (e.key === "Escape") {
                  onClose();
                }
              }}
              disabled={loading}
            />
            <p className="modal-hint">Enter → next · Shift+Tab ← back · Esc close</p>
          </div>
        )}

        {step.type === "autostart" && (
          <div className="modal-body">
            <p className="modal-hint" style={{ marginBottom: 4 }}>
              Opening: <strong>{step.title}</strong>
              {step.command && <code style={{ marginLeft: 6, fontSize: 11 }}>{step.command}</code>}
            </p>
            <label className="modal-autostart" style={{ fontSize: 13, gap: 8 }}>
              <input
                type="checkbox"
                checked={autostart}
                onChange={e => setAutostart(e.target.checked)}
                tabIndex={-1}
              />
              Auto-start on open
            </label>
            <p className="modal-hint" style={{ marginTop: 4 }}>Space toggle · Enter open · Esc close</p>
            <button
              className="btn btn-primary"
              style={{ marginTop: 4 }}
              onClick={() => doCreate(step.command, step.title, autostart)}
              disabled={loading}
            >
              {loading ? "Opening…" : "Open Terminal"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export type { TabEntry };
