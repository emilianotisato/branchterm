import {
  useCallback,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { Pane } from "./Pane";
import { Terminal } from "./Terminal";
import type { Pane as PaneState } from "../types";
import type { TabEntry } from "./MainArea";

interface PaneRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Props {
  panes: PaneState[];
  focusedPaneId: string | null;
  allTabs: TabEntry[];
  tabBranch: Record<string, string>;
  onFocusPane: (paneId: string) => void;
  onExit: (tabId: string) => void;
  onExitCode: (tabId: string, code: number) => void;
}

function rectsEqual(a: PaneRect | undefined, b: PaneRect): boolean {
  if (!a) return false;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

export function PaneLayout({
  panes,
  focusedPaneId,
  allTabs,
  tabBranch,
  onFocusPane,
  onExit,
  onExitCode,
}: Props) {
  const layoutRef = useRef<HTMLDivElement>(null);
  const paneAreasRef = useRef<Record<string, HTMLDivElement>>({});
  const paneRefCallbacks = useRef(new Map<string, (el: HTMLDivElement | null) => void>());
  const [paneRects, setPaneRects] = useState<Record<string, PaneRect>>({});
  const [areaVersion, bumpAreas] = useReducer((n: number) => n + 1, 0);

  const getPaneAreaRef = useCallback((paneId: string) => {
    let cb = paneRefCallbacks.current.get(paneId);
    if (!cb) {
      cb = (el: HTMLDivElement | null) => {
        if (el) paneAreasRef.current[paneId] = el;
        else delete paneAreasRef.current[paneId];
        bumpAreas();
      };
      paneRefCallbacks.current.set(paneId, cb);
    }
    return cb;
  }, []);

  const paneIdsKey = panes.map((p) => p.id).join(",");

  useLayoutEffect(() => {
    const layout = layoutRef.current;
    if (!layout) return;

    function measure() {
      if (!layout) return;
      const layoutRect = layout.getBoundingClientRect();
      setPaneRects((prev) => {
        const next: Record<string, PaneRect> = {};
        let changed = false;
        for (const pane of panes) {
          const el = paneAreasRef.current[pane.id];
          if (!el) continue;
          const r = el.getBoundingClientRect();
          const rect: PaneRect = {
            x: r.left - layoutRect.left,
            y: r.top - layoutRect.top,
            width: r.width,
            height: r.height,
          };
          next[pane.id] = rect;
          if (!rectsEqual(prev[pane.id], rect)) changed = true;
        }
        if (!changed && Object.keys(prev).length === Object.keys(next).length) {
          return prev;
        }
        return next;
      });
    }

    const raf = requestAnimationFrame(measure);
    const observers: ResizeObserver[] = [];
    for (const pane of panes) {
      const el = paneAreasRef.current[pane.id];
      if (!el) continue;
      const ro = new ResizeObserver(() => requestAnimationFrame(measure));
      ro.observe(el);
      observers.push(ro);
    }
    const layoutRo = new ResizeObserver(() => requestAnimationFrame(measure));
    layoutRo.observe(layout);
    window.addEventListener("resize", measure);

    return () => {
      cancelAnimationFrame(raf);
      observers.forEach((ro) => ro.disconnect());
      layoutRo.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [paneIdsKey, panes, areaVersion]);

  function ownerPaneId(tabId: string): string | null {
    return panes.find((p) => p.activeTabId === tabId)?.id ?? null;
  }

  const equalSize = panes.length > 0 ? 100 / panes.length : 100;

  return (
    <div className="pane-layout" ref={layoutRef}>
      <Group
        orientation="horizontal"
        className="pane-panel-group"
        onLayoutChanged={() => {
          requestAnimationFrame(() => {
            window.dispatchEvent(new CustomEvent("branchterm:pane-layout-changed"));
          });
        }}
      >
        {panes.flatMap((pane, i) => [
          <Panel
            key={pane.id}
            id={pane.id}
            minSize={10}
            defaultSize={equalSize}
            className="pane-panel"
            style={{
              display: "flex",
              flexDirection: "column",
              height: "100%",
              minHeight: 0,
              maxHeight: "100%",
              overflow: "hidden",
            }}
          >
            <Pane
              pane={pane}
              focused={pane.id === focusedPaneId}
              allTabs={allTabs}
              tabBranch={tabBranch}
              onFocus={() => onFocusPane(pane.id)}
              terminalAreaRef={getPaneAreaRef(pane.id)}
            />
          </Panel>,
          ...(i < panes.length - 1
            ? [<Separator key={`${pane.id}-handle`} className="pane-resize-handle" />]
            : []),
        ])}
      </Group>

      <div className="terminal-overlay">
        {allTabs.map((tab) => {
          const ownerId = ownerPaneId(tab.id);
          const rect = ownerId ? paneRects[ownerId] : null;
          const slotStyle: CSSProperties = rect
            ? {
                left: rect.x,
                top: rect.y,
                width: rect.width,
                height: rect.height,
                visibility: "visible",
                pointerEvents: ownerId === focusedPaneId ? "auto" : "none",
              }
            : {
                left: -10000,
                top: 0,
                width: 80,
                height: 24,
                visibility: "hidden",
                pointerEvents: "none",
              };

          return (
            <div key={tab.id} className="terminal-slot" style={slotStyle}>
              <Terminal
                tabId={tab.id}
                visible={ownerId !== null}
                focused={ownerId === focusedPaneId}
                onExit={() => onExit(tab.id)}
                onExitCode={(code) => onExitCode(tab.id, code)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
