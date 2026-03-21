/*---------------------------------------------------------------------------------------------
 *  Collab Server — Main Entry Point
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import express from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
// @ts-ignore — y-websocket utils do not ship type declarations
import { setupWSConnection } from 'y-websocket/bin/utils';
import { RoomManager } from './roomManager';
import { createRoomRouter } from './roomRouter';
import { TerminalManager } from './terminalManager';
import { DockerManager } from './dockerManager';

const PORT = parseInt(process.env.PORT || '4000', 10);

// Initialize managers
const roomManager = new RoomManager();
const terminalManager = new TerminalManager();
const dockerManager = new DockerManager();

// Express app
const app = express();
app.use(cors());
app.use(express.json());

// Mount REST routes
app.use('/api', createRoomRouter(roomManager));

// Health check
app.get('/health', (_req, res) => {
	res.json({ status: 'ok', rooms: roomManager.getAllRoomIds().length });
});

// Create HTTP server
const server = http.createServer(app);

// WebSocket server for y-websocket (CRDT sync)
const wss = new WebSocketServer({ noServer: true });

// Separate WebSocket server for terminal I/O
const terminalWss = new WebSocketServer({ noServer: true });

// Handle HTTP upgrade — route to correct WSS based on URL path
server.on('upgrade', (request, socket, head) => {
	const url = new URL(request.url || '/', `http://${request.headers.host}`);

	if (url.pathname === '/terminal') {
		terminalWss.handleUpgrade(request, socket, head, (ws) => {
			terminalWss.emit('connection', ws, request);
		});
	} else {
		// Default: y-websocket for CRDT sync
		wss.handleUpgrade(request, socket, head, (ws) => {
			wss.emit('connection', ws, request);
		});
	}
});

// y-websocket connection handler
wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
	// y-websocket uses the URL path as the room name
	setupWSConnection(ws, req);
	console.log(`[server] y-websocket client connected`);
});

// Terminal WebSocket connection handler
terminalWss.on('connection', (ws: WebSocket) => {
	console.log('[server] Terminal WebSocket client connected');

	ws.on('message', (data: Buffer) => {
		try {
			const msg = JSON.parse(data.toString());

			switch (msg.type) {
				case 'terminal:join': {
					const { roomId } = msg;
					terminalManager.addClient(roomId, ws);
					break;
				}
				case 'terminal:input': {
					const { roomId, data: inputData } = msg;
					terminalManager.writeInput(roomId, inputData);
					break;
				}
				case 'terminal:resize': {
					const { roomId, cols, rows } = msg;
					terminalManager.resize(roomId, cols, rows);
					break;
				}
				default:
					console.warn(`[server] Unknown terminal message type: ${msg.type}`);
			}
		} catch (err) {
			console.error('[server] Failed to parse terminal message:', err);
		}
	});
});

// Start server
server.listen(PORT, () => {
	console.log(`[server] Collaboration server running on port ${PORT}`);
	console.log(`[server]   REST API:    http://localhost:${PORT}/api`);
	console.log(`[server]   y-websocket: ws://localhost:${PORT}`);
	console.log(`[server]   Terminal WS: ws://localhost:${PORT}/terminal`);
	console.log(`[server]   Health:      http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
	console.log('[server] Shutting down...');
	terminalManager.dispose();
	dockerManager.dispose();
	server.close();
	process.exit(0);
});

process.on('SIGINT', () => {
	console.log('[server] Shutting down...');
	terminalManager.dispose();
	dockerManager.dispose();
	server.close();
	process.exit(0);
});
