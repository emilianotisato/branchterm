import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export function Scratchpad() {
  const [content, setContent] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    invoke<string>("read_scratchpad").then(setContent).catch(console.error);
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    setContent(val);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      invoke("write_scratchpad", { content: val }).catch(console.error);
    }, 500);
  }

  return (
    <div className="scratchpad">
      <textarea
        placeholder="Project notes (markdown)..."
        value={content}
        onChange={handleChange}
      />
    </div>
  );
}
