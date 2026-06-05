# WebView Tabs

**Type**: Feature (deferred)
**Status**: Draft
**Created**: 2026-06-04
**Author**: Emiliano Tisato
**Depends on**: Side-by-side terminal panes (Phases 1–3, complete)

## Overview

### Problem Statement
Developers running local dev servers want a live preview beside the terminal without switching to an external browser. A first-class WebView tab type embeds a real browser engine inside branchterm panes.

### Goals
- Tab type `webview` alongside existing terminal tabs
- Render via Tauri v2 child webviews (not iframes), positioned over pane areas
- Navigation controls in the pane header when a webview tab is active
- Persist webview tabs in `state.json` and restore on reopen
- Hide child webviews when HTML modals/overlays are open (z-order)

### Non-Goals
- Replacing the system browser for general browsing
- WebView-specific split behavior beyond what terminal panes already provide

## Requirements

### FR-10: WebView tab type
**Priority**: Must Have
A tab can be of type `webview` instead of `terminal`. WebView tabs have a URL instead of a startup command. In the sidebar they appear in the same list as terminal tabs, distinguished by a browser icon (🌐 or similar) instead of a colored status dot.

### FR-11: WebView creation
**Priority**: Must Have
The New Tab modal gains a type selector: **Terminal** (default) or **WebView**. Selecting WebView replaces the command/autostart fields with a URL field. Title is still editable.

### FR-12: WebView navigation controls
**Priority**: Must Have
When a WebView tab is active in a pane, the pane header shows navigation controls alongside the `{title} — {branch}` label: **← back**, **→ forward**, **⟳ refresh**, and an **address bar** (editable URL). Pressing Enter in the address bar navigates to the new URL (does not update the saved URL in state).

### FR-13: WebView persistence
**Priority**: Must Have
WebView tabs persist in `state.json` identically to terminal tabs (`id`, `title`, `type: "webview"`, `url`). On app reopen, they appear in the sidebar and are ready to display. No PTY is spawned for webview tabs.

### FR-14: WebView implementation — Tauri child webview
**Priority**: Must Have
WebView tabs are rendered as Tauri v2 child webviews (not iframes) embedded within the main window. This gives a real browser engine with devtools (right-click → inspect in debug builds; `open_devtools()` Tauri API for release builds requires `devtools` feature flag in Cargo.toml). The child webview is positioned and sized in physical pixels to align with the React pane area, synchronized via `ResizeObserver` + `invoke("set_webview_bounds", ...)`.

Creation API: `window.add_child(WebviewBuilder::new(label, WebviewUrl::External(url)), LogicalPosition, LogicalSize)`. Requires `unstable` Tauri feature flag.

**WebView tabs work in single-pane mode** — the single pane switches to showing the child webview just as it would switch to showing a terminal. No split required.

### FR-15: WebView z-ordering — modal hide/show
**Priority**: Must Have
Native child webviews sit above the HTML layer in z-order. When any of the following occur, **all currently-visible child webviews must be hidden** via `invoke("hide_webview", tabId)` and reshown when the trigger resolves:

| Trigger (hide) | Trigger (show) |
|---|---|
| Command palette opens | Command palette closes |
| Branch picker opens | Branch picker closes |
| Shortcuts modal opens | Shortcuts modal closes |
| Merge modal opens | Merge modal closes |
| New Tab modal opens | New Tab modal closes |
| Scratchpad opens | Scratchpad closes |
| Context menu opens on any pane header | Context menu closes |
| Pane closes (webview tab was active) | — (webview destroyed) |
| Active tab in pane switches away from webview | Active tab switches back to webview |

## User Story

### US-4: Dev server + live preview side by side
**As a** developer running a frontend dev server
**I want to** see the running app in a WebView pane next to the terminal running `npm run dev`
**So that** I can see live changes without switching to a browser

**Acceptance Criteria**:
- [ ] WebView tab created with URL `http://localhost:3001`
- [ ] Terminal tab with `npm run dev --port=3001` visible in left pane
- [ ] WebView tab visible in right pane, renders the app
- [ ] Refresh button in pane header reloads the WebView
- [ ] On app reopen, both tabs restore from state.json
- [ ] Command palette overlay correctly hides the WebView

## Technical Design

### Architecture (WebView additions)

```
App.tsx
├── modal open/close → hide_webview / show_webview for visible webview panes
│
├── Sidebar
│   └── TabRow ← browser icon for webview tabs
│
└── PaneLayout
    └── Pane
        ├── PaneHeader (nav controls when webview tab active)
        ├── Terminal (hidden if active tab is webview)
        └── WebViewPane placeholder ← ResizeObserver → set_webview_bounds

Tauri backend (Rust)
├── spawn_tab(branch, tabId)
│   ├── terminal tab → spawn PTY (existing)
│   └── webview tab  → create child Webview at initial bounds
├── set_webview_bounds(tabId, x, y, w, h)
├── navigate_webview(tabId, url)
├── webview_back / webview_forward / webview_reload(tabId)
└── hide_webview / show_webview(tabId)
```

### State Model

```typescript
interface TerminalTab {
  id: string;
  title: string;
  type: "terminal";
  startupCommand?: string;
  autostart: boolean;
}

interface WebviewTab {
  id: string;
  title: string;
  type: "webview";
  url: string;
}

type TabEntry = TerminalTab | WebviewTab;
```

**Rust (`state.rs`):**
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TabEntry {
    Terminal {
        id: String,
        title: String,
        startup_command: Option<String>,
        #[serde(default = "default_true")]
        autostart: bool,
    },
    Webview {
        id: String,
        title: String,
        url: String,
    },
}
```

Backward compat: existing `state.json` files have no `type` field. Migration defaults missing `type` to `"terminal"`.

### Components Affected

| Component | Change Type | Description |
|-----------|-------------|-------------|
| `src/App.tsx` | Modified | Wire modal open/close to webview hide/show |
| `src/components/Pane.tsx` | Modified | Nav controls in header when webview tab active |
| `src/components/WebViewPane.tsx` | New | Placeholder div; `ResizeObserver` → `set_webview_bounds` |
| `src/components/NewTabModal.tsx` | Modified | Terminal / WebView type selector; URL field |
| `src/components/Sidebar.tsx` | Modified | Browser icon for webview tabs |
| `src/types.ts` | Modified | `TabEntry` becomes `TerminalTab \| WebviewTab` |
| `src-tauri/src/state.rs` | Modified | `TabEntry` enum with serde tag; migration |
| `src-tauri/src/pty.rs` | Modified | `spawn_tab` skips PTY for webview tabs |
| `src-tauri/src/commands.rs` | Modified | `set_webview_bounds`, navigate, back/forward/reload, hide/show |

### Technical Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Child webview z-order overlays HTML modals | High | High | Every modal open/close calls `hide_webview`/`show_webview` |
| Bounds sync jitter on resize | Medium | Medium | Debounce by 1 rAF before `set_webview_bounds` |
| Wayland — run under XWayland | Low | Low | Launch with `GDK_BACKEND=x11`; add to `.desktop` and Makefile |
| `window.add_child()` requires `unstable` feature | Low | Medium | Pin Tauri version during implementation |
| `TermState` initialized for webview tabs | Low | Low | `computeInitialState` returns early for `type === "webview"` |
| `state.json` backward compat | Low | High | Default absent `type` field to `"terminal"` |

## Implementation Plan

> **Prerequisite**: Spike Tauri v2 child webview on Linux/Wayland before starting to confirm the API works on target hardware.

**Deliverables**:
- [ ] `TabEntry` union type in TS + Rust with backward-compat migration
- [ ] New Tab modal shows Terminal / WebView selector
- [ ] `spawn_tab` skips PTY for webview tabs; creates Tauri child webview
- [ ] `set_webview_bounds` Tauri command; `ResizeObserver` in `WebViewPane.tsx`
- [ ] Pane header nav controls wired to Tauri commands
- [ ] All modal open paths in `App.tsx` call `hide_webview` / `show_webview`
- [ ] WebView tabs persist and restore from `state.json`
- [ ] Sidebar shows browser icon for webview tabs
- [ ] `GDK_BACKEND=x11` added to Makefile install target and `.desktop` launcher

## Testing Strategy

### Manual Testing
- [ ] Create WebView tab via New Tab modal with URL `http://localhost:3001`
- [ ] WebView tab shows browser icon in sidebar
- [ ] Open WebView tab in pane: Tauri child webview appears in correct position
- [ ] Resize pane: webview repositions correctly with no offset
- [ ] Nav controls: back, forward, refresh, address bar all work
- [ ] Close app and reopen: webview tab restored from state.json
- [ ] Old state.json (no `type` field) loads without error; tabs default to terminal
- [ ] Scratchpad overlay hides webview
- [ ] Command palette overlay hides webview

## Acceptance Criteria

- [ ] WebView tab type creatable via New Tab modal
- [ ] Tauri child webview renders at correct bounds; tracks pane resize
- [ ] All modals fully cover webview (no z-order bleed-through)
- [ ] WebView tabs persist and restore from `state.json`
- [ ] Old `state.json` files migrate without error

## Open Questions (resolved during panes PRD)

- [x] Single-pane WebView → works exactly like single-pane terminal
- [x] TermState for webview tabs → skip; `computeInitialState` returns early for `type === "webview"`
- [x] state.json backward compat → missing `type` field defaults to `"terminal"`
- [x] Wayland + child webview → launch with `GDK_BACKEND=x11` (XWayland)
