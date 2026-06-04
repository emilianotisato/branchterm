import { useEffect, useRef, useState } from "react";

interface Props {
  branches: string[];
  onSelect: (branch: string) => void;
  onClose: () => void;
}

export function BranchPicker({ branches, onSelect, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [highlightIdx, setHighlightIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = branches.filter(b => {
    const label = b === "__main__" ? "main" : b;
    return label.toLowerCase().includes(query.toLowerCase());
  });

  const safeIdx = Math.min(highlightIdx, Math.max(0, filtered.length - 1));

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setHighlightIdx(0);
  }, [query]);

  function handleKeyDown(e: React.KeyboardEvent) {
    switch (e.key) {
      case "Escape":
        onClose();
        break;
      case "ArrowDown":
        e.preventDefault();
        setHighlightIdx(i => Math.min(i + 1, filtered.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightIdx(i => Math.max(i - 1, 0));
        break;
      case "Enter":
        if (filtered[safeIdx] !== undefined) onSelect(filtered[safeIdx]);
        break;
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal command-palette" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>New Terminal — Select Workspace</span>
          <button className="btn-icon" style={{ opacity: 1 }} onClick={onClose}>✕</button>
        </div>
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Filter workspace…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="palette-list">
          {filtered.length === 0 && (
            <div className="palette-empty">No workspaces match</div>
          )}
          {filtered.map((branch, i) => (
            <div
              key={branch}
              className={`palette-item${i === safeIdx ? " highlighted" : ""}`}
              onMouseEnter={() => setHighlightIdx(i)}
              onClick={() => onSelect(branch)}
            >
              <span className="palette-branch">{branch === "__main__" ? "main" : branch}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
