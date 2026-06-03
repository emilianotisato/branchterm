# **Product Requirements Document (PRD)**

**Project Name:** Parallel Branch Terminal Manager

**Target Platform:** Arch Linux (Btrfs File System)

**Document Status:** Final Blueprint (V5 \- Pristine XDG Architecture)

## **1\. Executive Summary**

A native desktop GUI invoked via CLI for managing parallel Git branches within a single project. By leveraging Btrfs file-level Copy-on-Write (CoW) and local Git fetching, it provides instant workspaces with embedded terminal emulators. The application strictly enforces system-level XDG isolation to prevent project directory pollution, keeping tools like Claude Code and global search entirely unconfused.

## **2\. Technology Stack**

* **Framework:** Tauri v2 (Multi-Process Architecture).  
* **Backend:** Rust (portable-pty for shell execution, std::os::unix::fs for mount checks).  
* **Frontend:** React JS \+ TypeScript.  
* **Terminal Engine:** xterm.js.  
* **Markdown Editor:** Lightweight React markdown component.

## **3\. Application Architecture & Boot Sequence**

* **Invocation:** Launched via the CLI inside a project directory (branchterm .).  
* **Process Model:** Multi-Process. Every execution spawns an isolated GUI window.  
* **Boot Checks (The Mount Guard):** Rust checks if the current working directory and \~/.local/share/ share the same filesystem device ID.  
  * If they mismatch, the app still boots but displays a permanent UI warning that CoW branch creation will fail.  
* **Initialization:** Rust generates a safe slug of the absolute project path (e.g., home\_user\_projects\_webapp) to map the project to its state and workspaces.

## **4\. File System Standards (XDG Pristine Isolation)**

The application leaves the main project completely untouched. All app data lives in standard Linux directories using the project's path-slug as the identifier.

* **Configuration & State:** \~/.config/branchterm/states/\<slug\>.json  
* **Markdown Scratchpad:** \~/.config/branchterm/scratchpads/\<slug\>.md  
* **Workspace Snapshots:** \~/.local/share/branchterm/workspaces/\<slug\>\_\<branch-name\>/

## **5\. Core Workflows**

### **5.1. Branch Creation (Clean CoW)**

1. User clicks "New Branch" \-\> inputs name (e.g., fix-typos).  
2. Rust identifies the current active branch in the main project and saves it as parentBranch in state.json.  
3. Rust runs the Btrfs reflink copy to the isolated XDG directory:  
   cp \-a \--reflink=always \<project-root\> \~/.local/share/branchterm/workspaces/\<slug\>\_fix-typos  
4. Rust navigates to the new workspace and runs: git checkout \-b fix-typos.

### **5.2. Safe Local Merging (Target Drift Guardrail)**

1. User clicks "Merge into Main".  
2. **Pre-Flight Check:** Rust compares the *current* branch of the main project against the parentBranch stored in state.json.  
3. **Match Scenario:** Rust runs git fetch \~/.local/.../\<slug\>\_fix-typos fix-typos followed by git merge FETCH\_HEAD.  
4. **Mismatch Scenario:** Halts the merge with a modal offering to safely git checkout \<parentBranch\> first, force the merge, or cancel.

### **5.3. Terminal Initialization & UI**

* **UI Grid:** Sidebar (Active Branches \+ Terminals), Main Area (xterm.js tabs), Right Pane (Expandable Scratchpad).  
* **Auto-Execution:** On launch, Rust parses state.json, spawns background PTYs mapped to the CoW directories, and pipes in stored Startup Commands.

