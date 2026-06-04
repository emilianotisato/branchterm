export interface FreqCommand {
  id: string;
  name: string;
  label: string;
  cmd: string;
  createdAt: string;
}

interface Props {
  commands: FreqCommand[];
  onPick: (cmd: string) => void;
  onClose: () => void;
}

export function CommandPicker({ commands, onPick, onClose }: Props) {
  return (
    <div className="cmd-picker-overlay" onClick={onClose}>
      <div className="cmd-picker" onClick={(e) => e.stopPropagation()}>
        <div className="cmd-picker-header">
          <span>Quick Commands</span>
          <button className="btn-icon" style={{ opacity: 1 }} onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="cmd-picker-list">
          {commands.map((c) => (
            <div key={c.id} className="cmd-picker-item" onClick={() => onPick(c.cmd)}>
              <span className="cmd-picker-label">{c.label}</span>
              <code className="cmd-picker-cmd">{c.cmd}</code>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
