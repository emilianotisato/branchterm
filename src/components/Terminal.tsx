import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import "@xterm/xterm/css/xterm.css";

interface Props {
  tabId: string;
  active: boolean;
  onExit: () => void;
  onExitCode: (code: number) => void;
}

export function Terminal({ tabId, active, onExit, onExitCode }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const unlistenExitRef = useRef<UnlistenFn | null>(null);
  const unlistenExitCodeRef = useRef<UnlistenFn | null>(null);

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
    }).then((ul) => { unlistenRef.current = ul; });

    // PTY process died (shell itself exited)
    listen<boolean>(`pty-exit-${tabId}`, () => {
      onExit();
    }).then((ul) => { unlistenExitRef.current = ul; });

    // Startup command exited — inline wrapper emits branchterm;ec=N OSC sequence
    listen<number>(`pty-exit-code-${tabId}`, (event) => {
      onExitCode(event.payload);
    }).then((ul) => { unlistenExitCodeRef.current = ul; });

    term.onData((data) => {
      invoke("pty_input", { tabId, data }).catch(console.error);
    });

    // Block handled Ctrl+Shift combos from reaching the PTY process.
    // The actual actions are handled by a global window listener in App.tsx,
    // which fires regardless of which element has DOM focus.
    term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (!e.ctrlKey || !e.shiftKey || e.type !== "keydown") return true;
      switch (e.code) {
        case "BracketRight":
        case "BracketLeft":
        case "KeyP":
        case "KeyT":
        case "KeyS":
          return false;
      }
      return true;
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
      unlistenExitRef.current?.();
      unlistenExitCodeRef.current?.();
      term.dispose();
    };
  }, [tabId]);

  useEffect(() => {
    if (!active) return;

    const sendResize = () => {
      const fit = fitRef.current;
      const term = termRef.current;
      if (!fit || !term) return;
      fit.fit();
      invoke("pty_resize", { tabId, cols: term.cols, rows: term.rows }).catch(console.error);
    };

    let t1: ReturnType<typeof setTimeout>;
    let t2: ReturnType<typeof setTimeout>;

    // rAF fires after browser layout is committed, so offsetWidth/offsetHeight are real
    const raf = requestAnimationFrame(() => {
      sendResize();
      termRef.current?.focus();
      // retries for TUIs that need more than one SIGWINCH to redraw
      t1 = setTimeout(sendResize, 100);
      t2 = setTimeout(sendResize, 350);
    });

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [active, tabId]);

  return (
    <div
      ref={containerRef}
      style={{
        position: "absolute",
        inset: 0,
        visibility: active ? "visible" : "hidden",
        pointerEvents: active ? "auto" : "none",
      }}
    />
  );
}
