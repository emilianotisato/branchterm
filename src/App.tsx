import { useRef, useState } from "react";
import { Sidebar, BranchEntry } from "./components/Sidebar";
import { MainArea } from "./components/MainArea";
import { Scratchpad } from "./components/Scratchpad";
import "./App.css";

export default function App() {
  const [scratchpadOpen, setScratchpadOpen] = useState(false);
  const [activeBranch, setActiveBranch] = useState<string | null>(null);
  const [openBranches, setOpenBranches] = useState<string[]>([]);
  const initialLoadDone = useRef(false);

  function handleSelectBranch(branch: string) {
    setActiveBranch(branch);
    setOpenBranches((prev) =>
      prev.includes(branch) ? prev : [...prev, branch]
    );
  }

  // Called by Sidebar on state load — only auto-open on initial boot
  function handleBranchesLoaded(branches: BranchEntry[]) {
    if (initialLoadDone.current) return;
    initialLoadDone.current = true;
    const names = ["__main__", ...branches.map((b) => b.name)];
    setOpenBranches(names);
    setActiveBranch("__main__");
  }

  return (
    <div className="app">
      <Sidebar
        activeBranch={activeBranch}
        onSelectBranch={handleSelectBranch}
        onBranchesChange={handleBranchesLoaded}
      />
      <MainArea
        activeBranch={activeBranch}
        openBranches={openBranches}
        onSelectBranch={setActiveBranch}
      />
      <div className={`right-pane ${scratchpadOpen ? "open" : ""}`}>
        <button
          className="scratchpad-toggle"
          onClick={() => setScratchpadOpen((v) => !v)}
          title={scratchpadOpen ? "Collapse scratchpad" : "Expand scratchpad"}
        >
          {scratchpadOpen ? "›" : "‹"}
        </button>
        {scratchpadOpen && <Scratchpad />}
      </div>
    </div>
  );
}
