import { useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { MainArea } from "./components/MainArea";
import { Scratchpad } from "./components/Scratchpad";
import "./App.css";

export default function App() {
  const [scratchpadOpen, setScratchpadOpen] = useState(false);
  const [activeBranch, setActiveBranch] = useState<string | null>(null);

  return (
    <div className="app">
      <Sidebar activeBranch={activeBranch} onSelectBranch={setActiveBranch} />
      <MainArea activeBranch={activeBranch} />
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
