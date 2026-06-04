import { useEffect, useRef, useState } from "react";

interface TabEntry {
  id: string;
  title: string;
}

interface Props {
  allTabs: TabEntry[];
  tabRecency: string[];
  tabBranch: Record<string, string>;
  currentTabId: string | null;
  onSelect: (tabId: string) => void;
  onClose: () => void;
}

export function CommandPalette({ allTabs, tabRecency, tabBranch, currentTabId, onSelect, onClose }: Props) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const orderedTabs: TabEntry[] = [
    ...tabRecency.map(id => allTabs.find(t => t.id === id)).filter((t): t is TabEntry => !!t),
    ...allTabs.filter(t => !tabRecency.includes(t.id)),
  ];

  const filtered = query
    ? orderedTabs.filter(t => {
        const branch = tabBranch[t.id] ?? "";
        const haystack = `${branch === "__main__" ? "main" : branch} ${t.title}`.toLowerCase();
        return query.toLowerCase().split("").every(c => haystack.includes(c));
      })
    : orderedTabs;

  const defaultIdx = Math.max(0, filtered.findIndex(t => t.id !== currentTabId));
  const [highlightIdx, setHighlightIdx] = useState(() => defaultIdx);
  const safeIdx = Math.min(highlightIdx, Math.max(0, filtered.length - 1));

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const idx = filtered.findIndex(t => t.id !== currentTabId);
    setHighlightIdx(Math.max(0, idx));
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        if (filtered[safeIdx]) onSelect(filtered[safeIdx].id);
        break;
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal command-palette" onClick={e => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Switch terminal…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="palette-list">
          {filtered.length === 0 && (
            <div className="palette-empty">No terminals match</div>
          )}
          {filtered.map((tab, i) => {
            const branch = tabBranch[tab.id] ?? "";
            const branchLabel = branch === "__main__" ? "main" : branch;
            const isCurrent = tab.id === currentTabId;
            return (
              <div
                key={tab.id}
                className={`palette-item${i === safeIdx ? " highlighted" : ""}${isCurrent ? " current" : ""}`}
                onMouseEnter={() => setHighlightIdx(i)}
                onClick={() => onSelect(tab.id)}
              >
                <span className="palette-branch">{branchLabel}</span>
                <span className="palette-title">{tab.title}</span>
                {isCurrent && <span className="palette-current-badge">current</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
