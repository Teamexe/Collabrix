# Collaborative Editing Extension for VS Code

Real-time multi-user collaborative code editing extension powered by Y.js CRDTs and WebSockets.

## Features

- **Real-time collaborative editing** — Multiple users edit the same file simultaneously with conflict-free resolution (CRDT)
- **Cursor presence & awareness** — See remote users' cursors and selections with colored decorations and name labels
- **Room-based collaboration** — Create/join rooms with unique IDs, share with collaborators
- **Shared terminal** — All users in a room share a synchronized terminal session
- **Docker environments** — Isolated per-room dev containers with resource limits
- **File sync** — Track which files are open across users, shared folder awareness
- **Extensibility** — Plugin hooks for AI suggestions, execution tracking, and debug sharing

## Architecture

```
┌─────────────────┐     ┌─────────────────┐
│  VS Code Inst A │     │  VS Code Inst B │
│  ┌───────────┐  │     │  ┌───────────┐  │
│  │CollabBind │◄─┼─────┼──►CollabBind │  │
│  │Awareness  │◄─┼─ws──┼──►Awareness  │  │
│  │SharedTerm │◄─┼─────┼──►SharedTerm │  │
│  └───────────┘  │     │  └───────────┘  │
└────────┬────────┘     └────────┬────────┘
         │                       │
         ▼                       ▼
┌─────────────────────────────────────────┐
│          Collab Server (:4000)          │
│  ┌──────────┐ ┌────────┐ ┌──────────┐  │
│  │y-websock │ │REST API│ │TermMgr   │  │
│  │(CRDT)    │ │(rooms) │ │(node-pty)│  │
│  └──────────┘ └────────┘ └──────────┘  │
│  ┌──────────────────────────────────┐   │
│  │       DockerManager             │   │
│  │  (per-room containers)          │   │
│  └──────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

## Quick Start

### 1. Install Server Dependencies

```bash
cd extensions/collab-edit/collab-server
npm install
npm run build
```

### 2. Start the Collaboration Server

```bash
cd extensions/collab-edit/collab-server
npm start
```

Server starts on port `4000` with:
- REST API: `http://localhost:4000/api`
- y-websocket: `ws://localhost:4000`  
- Terminal WS: `ws://localhost:4000/terminal`

### 3. Install Extension Dependencies

```bash
cd extensions/collab-edit
npm install
npm run compile
```

### 4. Launch VS Code

Launch the VS Code instance from the repo:
```bash
# From repo root
./scripts/code.bat  # Windows
./scripts/code.sh   # Linux/Mac
```

### 5. Create a Room (User A)

1. Open Command Palette (`Ctrl+Shift+P`)
2. Run: **Collab: Create Collaboration Room**
3. Enter your display name
4. Room ID is copied to clipboard — share it

### 6. Join the Room (User B)

1. Open another VS Code instance
2. Command Palette → **Collab: Join Collaboration Room**
3. Enter your name and paste the room ID

### 7. Start Collaborating!

- Open the same file in both instances
- Type in one — see changes appear in the other
- Cursors and selections are visible in real-time
- Use **Collab: Open Shared Terminal** for a synchronized terminal

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `collab.serverUrl` | `ws://localhost:4000` | WebSocket URL of collab server |
| `collab.serverHttpUrl` | `http://localhost:4000` | HTTP URL for REST API |
| `collab.userName` | (prompt) | Your display name |
| `collab.enableDocker` | `false` | Enable Docker isolation |

## Commands

| Command | Description |
|---------|-------------|
| `Collab: Create Collaboration Room` | Create a new room and become the host |
| `Collab: Join Collaboration Room` | Join an existing room by ID |
| `Collab: Leave Collaboration Room` | Disconnect from the current room |
| `Collab: Show Active Users` | List all users in the room |
| `Collab: Open Shared Terminal` | Open a terminal shared with all room users |

## REST API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/create-room` | POST | Create room. Body: `{ hostName }` |
| `/api/join-room` | POST | Join room. Body: `{ roomId, userName }` |
| `/api/leave-room` | POST | Leave room. Body: `{ roomId, userName }` |
| `/api/active-users/:roomId` | GET | List active users |
| `/api/rooms` | GET | List all rooms |
| `/health` | GET | Server health check |

## Docker Support

To enable Docker-based isolated environments:

1. Install Docker Desktop
2. Build the dev environment image:
   ```bash
   cd extensions/collab-edit/collab-server
   docker build -f Dockerfile.devenv -t collab-devenv .
   ```
3. Set `collab.enableDocker: true` in VS Code settings
4. Containers are created per room with:
   - 512 MB memory limit
   - 50% CPU quota
   - Auto-cleanup on session end

## How It Works

### CRDT Synchronization
Each file edited collaboratively gets its own `Y.Doc` containing a `Y.Text` named `"content"`. Changes flow bidirectionally:

1. **Local edit** → `onDidChangeTextDocument` → `Y.Text.insert()/delete()` → WebSocket → other clients
2. **Remote edit** → `Y.Text.observe()` → `vscode.workspace.applyEdit()` → local editor updates

Echo loops are prevented via suppress flags and Y.js transaction origins.

### Cursor Awareness
Uses Y.js Awareness protocol to broadcast cursor position, selection range, and user identity. Remote cursors are rendered as VS Code editor decorations with user-specific colors and name labels.

## License

MIT
