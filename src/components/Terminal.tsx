import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import "@xterm/xterm/css/xterm.css";

interface Props {
  tabId: string;
  visible: boolean;
  focused: boolean;
  onExit: () => void;
  onExitCode: (code: number) => void;
}

export function Terminal({ tabId, visible, focused, onExit, onExitCode }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const unlistenExitRef = useRef<UnlistenFn | null>(null);
  const unlistenExitCodeRef = useRef<UnlistenFn | null>(null);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

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

    listen<boolean>(`pty-exit-${tabId}`, () => {
      onExit();
    }).then((ul) => { unlistenExitRef.current = ul; });

    listen<number>(`pty-exit-code-${tabId}`, (event) => {
      onExitCode(event.payload);
    }).then((ul) => { unlistenExitCodeRef.current = ul; });

    term.onData((data) => {
      invoke("pty_input", { tabId, data }).catch(console.error);
    });

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
      if (!visibleRef.current) return;
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
    if (!focused) return;
    function handler() { termRef.current?.focus(); }
    window.addEventListener("branchterm:focus-terminal", handler);
    return () => window.removeEventListener("branchterm:focus-terminal", handler);
  }, [focused]);

  useEffect(() => {
    if (!visible) return;
    function onLayoutChange() {
      const fit = fitRef.current;
      const term = termRef.current;
      if (!fit || !term) return;
      requestAnimationFrame(() => {
        fit.fit();
        invoke("pty_resize", { tabId, cols: term.cols, rows: term.rows }).catch(console.error);
      });
    }
    window.addEventListener("branchterm:pane-layout-changed", onLayoutChange);
    return () => window.removeEventListener("branchterm:pane-layout-changed", onLayoutChange);
  }, [visible, tabId]);

  useEffect(() => {
    if (!focused) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.type !== "keydown") return;
      if (!e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key !== "Enter" && e.code !== "Enter") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      invoke("pty_input", { tabId, data: "\x1b[13;2u" }).catch(console.error);
    }
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [focused, tabId]);

  useEffect(() => {
    if (!visible) return;

    const sendResize = () => {
      const fit = fitRef.current;
      const term = termRef.current;
      if (!fit || !term) return;
      fit.fit();
      invoke("pty_resize", { tabId, cols: term.cols, rows: term.rows }).catch(console.error);
    };

    let t1: ReturnType<typeof setTimeout>;
    let t2: ReturnType<typeof setTimeout>;

    const raf = requestAnimationFrame(() => {
      sendResize();
      if (focused) termRef.current?.focus();
      t1 = setTimeout(sendResize, 100);
      t2 = setTimeout(sendResize, 350);
    });

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [visible, focused, tabId]);

  return (
    <div
      ref={containerRef}
      className="terminal-host"
      style={{
        visibility: visible ? "visible" : "hidden",
        pointerEvents: focused ? "auto" : "none",
      }}
    />
  );
}
