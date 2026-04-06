/*---------------------------------------------------------------------------------------------
 *  Collaborative Editing Extension for VS Code
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * Shared terminal that syncs I/O across all users in a collaboration room.
 *
 * Connects via WebSocket to the server's /terminal endpoint.
 * Falls back to a local shell if the WebSocket server is unreachable.
 */
export class SharedTerminal implements vscode.Disposable {
	private _terminal: vscode.Terminal | null = null;
	private _ws: any = null;
	private _writeEmitter = new vscode.EventEmitter<string>();
	private _closeEmitter = new vscode.EventEmitter<void>();
	private readonly _roomId: string;
	private readonly _serverUrl: string;
	private readonly _containerId?: string | null;

	constructor(roomId: string, serverUrl: string, containerId?: string | null) {
		this._roomId = roomId;
		// Convert ws:// URL to use /terminal path
		this._serverUrl = serverUrl.replace(/\/?$/, '/terminal');
		this._containerId = containerId;
	}

	/**
	 * Open the shared terminal in VS Code.
	 */
	open(): void {
		if (this._terminal) {
			this._terminal.show();
			return;
		}

		// Use Node.js 'ws' module (browser WebSocket doesn't exist in Extension Host)
		let wsModule: any;
		try {
			wsModule = require('ws');
		} catch {
			this._openLocalTerminal('(ws module not found)');
			return;
		}

		try {
			const ws = new wsModule(this._serverUrl);
			let connected = false;

			// Give the server 3 seconds to respond
			const timeout = setTimeout(() => {
				if (!connected) {
					try { ws.close(); } catch { /* ignore */ }
					this._openLocalTerminal('(connection timed out)');
				}
			}, 3000);

			ws.on('open', () => {
				connected = true;
				clearTimeout(timeout);
				this._ws = ws;
				this._openWebSocketTerminal();
			});

			ws.on('error', () => {
				if (!connected) {
					connected = true;
					clearTimeout(timeout);
					this._openLocalTerminal('(server not reachable)');
				}
			});
		} catch (err) {
			this._openLocalTerminal(`(${err})`);
		}
	}

	/**
	 * Open a Pseudoterminal connected through WebSocket for true shared I/O.
	 */
	private _openWebSocketTerminal(): void {
		const pty: vscode.Pseudoterminal = {
			onDidWrite: this._writeEmitter.event,
			onDidClose: this._closeEmitter.event,
			open: () => {
				this._ws.send(JSON.stringify({
					type: 'terminal:join',
					roomId: this._roomId
				}));

				this._writeEmitter.fire(
					'\r\n\x1b[32m✓ Connected to shared terminal\x1b[0m\r\n\r\n'
				);

				if (this._containerId) {
					setTimeout(() => {
						this._sendInput(`docker exec -it ${this._containerId} /bin/bash\r`);
						setTimeout(() => {
							this._sendInput(`clear\r`);
						}, 300);
					}, 500);
				}
			},
			close: () => this._disconnect(),
			handleInput: (data: string) => this._sendInput(data),
			setDimensions: (dimensions: vscode.TerminalDimensions) => {
				this._sendResize(dimensions.columns, dimensions.rows);
			}
		};

		this._ws.on('message', (data: any) => {
			try {
				const msg = JSON.parse(data.toString());
				if (msg.type === 'terminal:output') {
					this._writeEmitter.fire(msg.data);
				} else if (msg.type === 'terminal:exit') {
					this._writeEmitter.fire(
						'\r\n\x1b[31m✗ Terminal session ended\x1b[0m\r\n'
					);
					this._closeEmitter.fire();
				}
			} catch {
				this._writeEmitter.fire(data.toString());
			}
		});

		this._ws.on('close', () => {
			this._writeEmitter.fire(
				'\r\n\x1b[33m⚠ Terminal disconnected\x1b[0m\r\n'
			);
		});

		this._terminal = vscode.window.createTerminal({
			name: `Shared Terminal [${this._roomId.substring(0, 8)}]`,
			pty
		});
		this._terminal.show();
	}

	/**
	 * Fallback: open a regular local VS Code terminal.
	 * This always works, even without a backend server.
	 */
	private _openLocalTerminal(reason: string): void {
		console.log(`[collab] Falling back to local terminal ${reason}`);

		const shellPath = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';

		this._terminal = vscode.window.createTerminal({
			name: `Collab Terminal [${this._roomId.substring(0, 8)}]`,
			shellPath,
		});
		this._terminal.show();

		// If Docker is up, auto-exec into the container
		if (this._containerId) {
			setTimeout(() => {
				this._terminal?.sendText(`docker exec -it ${this._containerId} /bin/bash`);
			}, 500);
		}

		vscode.window.showWarningMessage(
			`Shared terminal relay not available ${reason}. Opened a local terminal instead.`
		);
	}

	/**
	 * Send input to the server terminal.
	 */
	private _sendInput(data: string): void {
		if (this._ws && this._ws.readyState === 1 /* OPEN */) {
			this._ws.send(JSON.stringify({
				type: 'terminal:input',
				roomId: this._roomId,
				data
			}));
		}
	}

	/**
	 * Send resize event to the server terminal.
	 */
	private _sendResize(cols: number, rows: number): void {
		if (this._ws && this._ws.readyState === 1 /* OPEN */) {
			this._ws.send(JSON.stringify({
				type: 'terminal:resize',
				roomId: this._roomId,
				cols,
				rows
			}));
		}
	}

	/**
	 * Disconnect the WebSocket.
	 */
	private _disconnect(): void {
		if (this._ws) {
			try { this._ws.close(); } catch { /* ignore */ }
			this._ws = null;
		}
	}

	dispose(): void {
		this._disconnect();
		this._terminal?.dispose();
		this._terminal = null;
		this._writeEmitter.dispose();
		this._closeEmitter.dispose();
	}
}
