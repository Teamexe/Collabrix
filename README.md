# Collabrix

<p>
  This project presents a next-generation, AI-powered collaborative Integrated
Development Environment (IDE) designed to
transform how distributed teams build,
debug, and deploy software. The platform
provides CRDT-synced real-time editing, live
multi-user terminals, and a visual task
dashboard that displays per-task percent-complete (manual + AI-estimated). Its core
innovation is a Smart Terminal Emulator that
understands single-sentence natural
language and voice instructions, translates
intent into safe, context aware shell
workflows, fuzzy-resolves project paths, and
visualizes outputs for rapid comprehension.
Environment drift is eliminated by automatic,
auditable dependency and devcontainer
syncs; an Intent Prefetcher predicts and pre-builds likely dependencies to accelerate CI
and developer onboarding. The system
continuously monitors builds and
deployments, captures per-user error
contexts (commands, logs, environment
snapshot), and presents AI generated
diagnoses with one-click fixes or PRs.
Collaboration is enhanced with semantic
merge/repair, shared terminal checkpointing
and handoff, command recipes, and an AI
task router that assigns and forecasts risk.
An administrator console enforces fine-grained folder and command access policies
and maintains a secure audit trail, ensuring
data integrity and compliance. Together,
these features create a living, intelligent
workspace that reduces friction, prevents
“works-on-my-machine” problems, and
substantially improves team productivity and
reliability
</p>

## Key Features

- **Real-time Collaborative Editing**: CRDT-based synchronization (powered by Y.js) allows multiple users to edit the same file simultaneously without conflicts.
- **Cursor Presence & Awareness**: See remote users' cursors and selections in real-time, complete with distinctive colors and name labels.
- **Room-based Collaboration**: Easily create or join unique collaboration sessions to work securely with your team.
- **Shared Live Terminals**: Synchronized terminal sessions allow all participants in a room to run commands, view outputs, and troubleshoot together.
- **Isolated Docker Environments**: Automatic provisioning of per-room dev containers with resource limits (512 MB memory, 50% CPU quota) directly integrated.
- **File & Workspace Synchronization**: Tracks opened files across remote users to maintain shared situational awareness.
- **Smart Terminal Emulator**: Understands natural language instructions and translates them into safe shell workflows, while fuzzy-resolving project paths.
- **AI Task Dashboard**: Visual task tracking featuring manual and AI-estimated percent-completion.
- **Intent Prefetcher & Auto-sync**: Eliminates environment drift by automatically syncing dependencies and devcontainers, pre-building likely requirements.
- **Continuous Build & Deployment Monitoring**: Captures error contexts per user (commands, logs, snapshots) to provide AI-generated diagnoses and one-click fixes.
- **AI Task Router & Risk Forecasting**: Intelligently assigns tasks and predicts risks to streamline team workflows.
- **Administrator Console**: Enforces fine-grained folder and command access policies with a secure audit trail to guarantee compliance and data integrity.

## Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v22+)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Optional, for isolated devcontainers)

### Server Setup

1. Navigate to the server directory: 
   ```bash
   cd extensions/collab-edit/collab-server
   ```
2. Install dependencies: 
   ```bash
   npm install
   ```
3. Build the server: 
   ```bash
   npm run build
   ```
4. Start the server (runs on port 4000): 
   ```bash
   npm start
   ```

### Extension Setup

1. Navigate to the extension directory: 
   ```bash
   cd extensions/collab-edit
   ```
2. Install dependencies: 
   ```bash
   npm install
   ```
3. Compile the extension: 
   ```bash
   npm run compile
   ```

### Launching Collabrix
From the repository root, launch the customized VS Code instance:

- **Windows**: 
  ```bash
  .\scripts\code.bat
  ```
- **Linux/macOS**: 
  ```bash
  ./scripts/code.sh
  ```

Once inside, open the Command Palette (`Ctrl+Shift+P`) and type **Collab** to create or join a collaboration room.
