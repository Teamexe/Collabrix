# Collabrix

> A next-generation, AI-powered collaborative IDE built on VS Code — designed to eliminate the friction of distributed software development.

---

## The Problem

Distributed dev teams face a set of recurring, costly problems:

- "It works on my machine" — environment drift between teammates
- Slow onboarding — new devs spend days setting up environments
- Context loss — handoffs between teammates lose critical state
- Coordination overhead — tracking who's doing what, and what's broken
- Merge conflicts and diverging codebases during parallel work

Collabrix is built to solve all of these at once.

---

## What Collabrix Is

Collabrix is a VS Code fork that turns a solo IDE into a living, shared workspace. Every team member works in the same environment, sees the same state, and gets AI assistance throughout — from writing code to diagnosing failures to managing tasks.

---

## Core Architecture

Collabrix is organized around four pillars:

### 1. Real-Time Collaboration
- CRDT-based co-editing powered by [Y.js](https://yjs.dev/) — multiple users edit the same file simultaneously with zero conflicts
- Live cursor presence with per-user colors and name labels
- Room-based sessions — create or join a collaboration room via the Command Palette
- File and workspace awareness — see which files teammates have open

### 2. Shared Environment
- Per-room isolated Docker containers provisioned automatically (512 MB memory, 50% CPU quota)
- Shared live terminals — all room participants see the same terminal, run commands together, and hand off sessions with full checkpoint/restore
- Automatic dependency and devcontainer sync — environment drift is eliminated; everyone runs the same stack
- Intent Prefetcher — predicts likely dependencies based on current work and pre-builds them to accelerate CI and onboarding

### 3. AI-Powered Assistance
- Smart Terminal Emulator — understands single-sentence natural language and voice instructions, translates intent into safe, context-aware shell workflows, and fuzzy-resolves project paths
- Continuous build and deployment monitoring — captures per-user error context (commands, logs, environment snapshot) and presents AI-generated diagnoses with one-click fixes or PR suggestions
- Semantic merge and repair — AI-assisted conflict resolution that understands code intent, not just text diffs
- Command recipes — reusable, shareable shell workflows for common team tasks

### 4. Task Intelligence & Governance
- AI Task Dashboard — visual per-task progress tracking with both manual and AI-estimated percent-completion
- AI Task Router — intelligently assigns tasks to team members and forecasts delivery risk
- Administrator Console — fine-grained folder and command access policies, enforced at runtime
- Secure audit trail — every action is logged for compliance and accountability

---

## Key Features at a Glance

| Feature | Description |
|---|---|
| Extensions Marketplace | Integrated with **Open VSX** for seamless module discovery |
| CRDT Co-editing | Conflict-free simultaneous editing via Y.js |
| Cursor Presence | Live remote cursors with colors and labels |
| Room Sessions | Create/join collaboration rooms instantly |
| Shared Terminals | Synchronized terminal with checkpoint & handoff |
| Docker Isolation | Auto-provisioned per-room dev containers |
| Smart Terminal | Natural language → safe shell commands |
| Intent Prefetcher | Pre-builds predicted dependencies |
| Auto Env Sync | Eliminates environment drift automatically |
| AI Diagnostics | Error context capture + one-click fixes |
| Task Dashboard | Manual + AI-estimated task completion |
| AI Task Router | Task assignment + risk forecasting |
| Admin Console | Access policies + full audit trail |

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v22+
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (optional, for isolated devcontainers)

### 0. Quick Start (One Command)

We provide a specialized setup script that handles dependency installation, extension compilation, and server setup in one go:

```bash
chmod +x ./scripts/collabrix-setup.sh
./scripts/collabrix-setup.sh
```

### 1. Start the Collaboration Server

```bash
cd extensions/collab-edit/collab-server
npm install
npm run build
npm start
# Server runs on port 4000
```

### 2. Set Up the Extension

```bash
cd extensions/collab-edit
npm install
npm run compile
```

### 3. Launch Collabrix

From the repository root:

```bash
# Linux / macOS
./scripts/code.sh

# Windows
.\scripts\code.bat
```

Open the Command Palette (`Ctrl+Shift+P`) and type **Collab** to create or join a room.

---

## Extension Marketplace

Collabrix is migrated to the **Open VSX Registry** (`https://open-vsx.org`). This provides access to thousands of open-source extensions without proprietary Microsoft marketplace restrictions.

> [!NOTE]
> We have implemented safety rails in the Extension Gallery Service to ensure stability even when official AI/Chat agent configurations are missing.

---

## Troubleshooting

### Terminal fails to open
If the integrated terminal fails to launch with a "ptyHost terminated" error, the native modules likely need to be rebuilt for the Electron version:

```bash
export npm_config_runtime=electron
export npm_config_target=39.8.0
export npm_config_disturl=https://electronjs.org/headers
export VSCODE_FORCE_INSTALL=1
node build/npm/postinstall.ts
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| IDE Base | VS Code (open-source fork) |
| Language | TypeScript, Rust (CLI) |
| Real-time Sync | Y.js (CRDT) |
| Runtime | Electron, Node.js, Browser APIs |
| Containers | Docker |
| Build | npm, gulp, webpack |
| Testing | Mocha |

---

## Project Structure

```
src/vs/
  base/          # Cross-platform utilities and abstractions
  platform/      # Injectable services (files, config, terminal, etc.)
  editor/        # Text editor core and language services
  workbench/     # Main app UI, contributions, extension host
  sessions/      # Agentic workflows layer
extensions/
  collab-edit/   # Collabrix collaboration extension + server
cli/             # Rust-based CLI
build/           # CI/CD and build tooling
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, coding guidelines, and how to submit changes.
