/*---------------------------------------------------------------------------------------------
 *  Collab Server — Terminal Manager
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as pty from 'node-pty';
import { WebSocket } from 'ws';

interface TerminalSession {
	ptyProcess: pty.IPty;
	clients: Set<WebSocket>;
}

/**
 * Server-side terminal management.
 *
 * Uses node-pty to spawn shell processes per room.
 * Broadcasts terminal output to all WebSocket clients in the room.
 * Receives terminal input from clients and writes to pty stdin.
 */
export class TerminalManager {
	private readonly _sessions: Map<string, TerminalSession> = new Map();

	/**
	 * Create or get a terminal session for a room.
	 */
	getOrCreateSession(roomId: string, shell?: string): TerminalSession {
		let session = this._sessions.get(roomId);
		if (session) {
			return session;
		}

		// Determine shell based on platform
		const defaultShell = process.platform === 'win32'
			? 'powershell.exe'
			: (process.env.SHELL || '/bin/bash');

		const ptyProcess = pty.spawn(shell || defaultShell, [], {
			name: 'xterm-256color',
			cols: 120,
			rows: 30,
			cwd: process.cwd(),
			env: process.env as { [key: string]: string }
		});

		session = {
			ptyProcess,
			clients: new Set()
		};

		// Broadcast pty output to all connected clients
		ptyProcess.onData((data: string) => {
			const message = JSON.stringify({
				type: 'terminal:output',
				roomId,
				data
			});

			for (const client of session!.clients) {
				if (client.readyState === WebSocket.OPEN) {
					client.send(message);
				}
			}
		});

		ptyProcess.onExit(({ exitCode, signal }) => {
			console.log(`[server] Terminal for room ${roomId} exited (code=${exitCode}, signal=${signal})`);
			this._sessions.delete(roomId);

			// Notify clients
			const exitMessage = JSON.stringify({
				type: 'terminal:exit',
				roomId,
				exitCode,
				signal
			});
			for (const client of session!.clients) {
				if (client.readyState === WebSocket.OPEN) {
					client.send(exitMessage);
				}
			}
		});

		this._sessions.set(roomId, session);
		console.log(`[server] Terminal session created for room ${roomId}`);
		return session;
	}

	/**
	 * Add a WebSocket client to a terminal session.
	 */
	addClient(roomId: string, ws: WebSocket): void {
		const session = this.getOrCreateSession(roomId);
		session.clients.add(ws);

		ws.on('close', () => {
			session.clients.delete(ws);
			console.log(`[server] Terminal client disconnected from room ${roomId}`);
		});

		console.log(`[server] Terminal client connected to room ${roomId} (${session.clients.size} total)`);
	}

	/**
	 * Write input to a room's terminal.
	 */
	writeInput(roomId: string, data: string): void {
		const session = this._sessions.get(roomId);
		if (session) {
			session.ptyProcess.write(data);
		}
	}

	/**
	 * Resize a room's terminal.
	 */
	resize(roomId: string, cols: number, rows: number): void {
		const session = this._sessions.get(roomId);
		if (session) {
			session.ptyProcess.resize(cols, rows);
		}
	}

	/**
	 * Destroy a room's terminal session.
	 */
	destroySession(roomId: string): void {
		const session = this._sessions.get(roomId);
		if (session) {
			session.ptyProcess.kill();
			this._sessions.delete(roomId);
			console.log(`[server] Terminal session destroyed for room ${roomId}`);
		}
	}

	/**
	 * Destroy all terminal sessions.
	 */
	dispose(): void {
		for (const [roomId, session] of this._sessions) {
			session.ptyProcess.kill();
			console.log(`[server] Terminal session destroyed for room ${roomId}`);
		}
		this._sessions.clear();
	}
}
