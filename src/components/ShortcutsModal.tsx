const SHORTCUTS = [
  { keys: "Ctrl+Shift+P", action: "Command palette — switch terminal (Enter = previous)" },
  { keys: "Ctrl+Shift+]", action: "Next terminal tab" },
  { keys: "Ctrl+Shift+[", action: "Previous terminal tab" },
  { keys: "Ctrl+Shift+T", action: "New terminal — pick workspace" },
  { keys: "Ctrl+Shift+S", action: "Open scratchpad, cursor at end" },
];

interface Props {
  onClose: () => void;
}

export function ShortcutsModal({ onClose }: Props) {
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") onClose();
  }

  return (
    <div className="modal-overlay" onClick={onClose} onKeyDown={handleKeyDown}>
      <div className="modal shortcuts-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>Keyboard Shortcuts</span>
          <button className="btn-icon" style={{ opacity: 1 }} onClick={onClose}>✕</button>
        </div>
        <div className="shortcuts-list">
          {SHORTCUTS.map(s => (
            <div key={s.keys} className="shortcut-row">
              <kbd className="shortcut-keys">{s.keys}</kbd>
              <span className="shortcut-action">{s.action}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
