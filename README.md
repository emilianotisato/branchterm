# branchterm

Parallel branch terminal manager for AI-assisted development. Uses Btrfs Copy-on-Write to create instant isolated workspaces per git branch, each with an embedded terminal.

## Requirements

- **Arch Linux** with **Btrfs** filesystem (project dir and `~/.local/share` must be on the same Btrfs volume)
- **Rust** + **Cargo**
- **Node.js** + **npm**
- **git** initialized in your project

### Fonts (recommended)

A [Nerd Font](https://www.nerdfonts.com/) is strongly recommended for correct icon rendering in TUI tools (lazygit, etc.). Install on Arch:

```bash
sudo pacman -S ttf-jetbrains-mono-nerd
```

branchterm uses `JetBrainsMono Nerd Font Mono` by default. Without it, terminals still work but TUI icons may render as boxes.

## Install / Update

```bash
make install
```

Builds the release binary and copies it to `~/.local/bin/branchterm`. Same command to update after pulling new changes.

Make sure `~/.local/bin` is in your `PATH` (add to `~/.bashrc` or `~/.zshrc` if not):

```bash
export PATH="$HOME/.local/bin:$PATH"
```

## Usage

```bash
branchterm /path/to/project
# or from inside the project:
branchterm .
```

## Development

```bash
# Run dev build (always pass your project path)
BRANCHTERM_PROJECT=~/Projects/test-branchterm/ npm run tauri dev
```
