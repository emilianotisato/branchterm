import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import "@xterm/xterm/css/xterm.css";

interface Props {
  tabId: string;
  active: boolean;
}

export function Terminal({ tabId, active }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new XTerm({
      theme: {
        background: "#1e1e1e",
        foreground: "#d4d4d4",
        cursor: "#d4d4d4",
        selectionBackground: "#264f78",
        black: "#1e1e1e",
        brightBlack: "#808080",
        red: "#f44747",
        brightRed: "#f44747",
        green: "#4caf50",
        brightGreen: "#4caf50",
        yellow: "#dcdcaa",
        brightYellow: "#dcdcaa",
        blue: "#569cd6",
        brightBlue: "#569cd6",
        magenta: "#c678dd",
        brightMagenta: "#c678dd",
        cyan: "#4ec9b0",
        brightCyan: "#4ec9b0",
        white: "#d4d4d4",
        brightWhite: "#ffffff",
      },
      fontFamily: '"JetBrainsMono Nerd Font Mono", "JetBrainsMono NFM", monospace',
      fontSize: 13,
      letterSpacing: 0,
      lineHeight: 1.2,
      cursorBlink: true,
      allowProposedApi: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;

    listen<string>(`pty-output-${tabId}`, (event) => {
      const bytes = Uint8Array.from(atob(event.payload), (c) => c.charCodeAt(0));
      term.write(bytes);
    }).then((unlisten) => {
      unlistenRef.current = unlisten;
    });

    term.onData((data) => {
      invoke("pty_input", { tabId, data }).catch(console.error);
    });

    const ro = new ResizeObserver(() => {
      fit.fit();
      invoke("pty_resize", {
        tabId,
        cols: term.cols,
        rows: term.rows,
      }).catch(console.error);
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      unlistenRef.current?.();
      term.dispose();
    };
  }, [tabId]);

  useEffect(() => {
    if (active && fitRef.current) {
      setTimeout(() => fitRef.current?.fit(), 50);
    }
  }, [active]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        display: active ? "block" : "none",
      }}
    />
  );
}
