import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Props {
  focusRequest?: number;
}

export function Scratchpad({ focusRequest }: Props) {
  const [content, setContent] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    invoke<string>("read_scratchpad").then(setContent).catch(console.error);
  }, []);

  useEffect(() => {
    if (!focusRequest) return;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    el.scrollTop = el.scrollHeight;
  }, [focusRequest]);

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
        ref={textareaRef}
        placeholder="Project notes (markdown)..."
        value={content}
        onChange={handleChange}
      />
    </div>
  );
}
