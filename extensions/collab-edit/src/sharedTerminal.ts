/*---------------------------------------------------------------------------------------------
 *  Collaborative Editing Extension for VS Code
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * Shared terminal that syncs I/O across all users in a collaboration room.
 *
 * Connects via WebSocket to the server's /terminal endpoint.
 * Implements vscode.Pseudoterminal to pipe data through the WebSocket.
 */
export class SharedTerminal implements vscode.Disposable {
	private _terminal: vscode.Terminal | null = null;
	private _ws: WebSocket | null = null;
	private _writeEmitter = new vscode.EventEmitter<string>();
	private _closeEmitter = new vscode.EventEmitter<void>();
	private readonly _roomId: string;
	private readonly _serverUrl: string;

	constructor(roomId: string, serverUrl: string) {
		this._roomId = roomId;
		// Convert ws:// URL to use /terminal path
		this._serverUrl = serverUrl.replace(/\/?$/, '/terminal');
	}

	/**
	 * Open the shared terminal in VS Code.
	 */
	open(): void {
		if (this._terminal) {
			this._terminal.show();
			return;
		}

		const pty: vscode.Pseudoterminal = {
			onDidWrite: this._writeEmitter.event,
			onDidClose: this._closeEmitter.event,
			open: () => this._connect(),
			close: () => this._disconnect(),
			handleInput: (data: string) => this._sendInput(data),
			setDimensions: (dimensions: vscode.TerminalDimensions) => {
				this._sendResize(dimensions.columns, dimensions.rows);
			}
		};

		this._terminal = vscode.window.createTerminal({
			name: `Shared Terminal [${this._roomId.substring(0, 8)}]`,
			pty
		});

		this._terminal.show();
	}

	/**
	 * Connect to the terminal WebSocket.
	 */
	private _connect(): void {
		try {
			this._ws = new WebSocket(this._serverUrl);

			this._ws.onopen = () => {
				// Join the terminal room
				this._ws!.send(JSON.stringify({
					type: 'terminal:join',
					roomId: this._roomId
				}));

				this._writeEmitter.fire(
					'\r\n\x1b[32m✓ Connected to shared terminal\x1b[0m\r\n\r\n'
				);
			};

			this._ws.onmessage = (event: MessageEvent) => {
				try {
					const msg = JSON.parse(event.data as string);
					if (msg.type === 'terminal:output') {
						this._writeEmitter.fire(msg.data);
					} else if (msg.type === 'terminal:exit') {
						this._writeEmitter.fire(
							'\r\n\x1b[31m✗ Terminal session ended\x1b[0m\r\n'
						);
						this._closeEmitter.fire();
					}
				} catch {
					// Raw data — write directly
					this._writeEmitter.fire(event.data as string);
				}
			};

			this._ws.onerror = (_event: Event) => {
				this._writeEmitter.fire(
					'\r\n\x1b[31m✗ Terminal connection error\x1b[0m\r\n'
				);
			};

			this._ws.onclose = () => {
				this._writeEmitter.fire(
					'\r\n\x1b[33m⚠ Terminal disconnected\x1b[0m\r\n'
				);
			};
		} catch (err) {
			this._writeEmitter.fire(
				`\r\n\x1b[31m✗ Failed to connect: ${err}\x1b[0m\r\n`
			);
		}
	}

	/**
	 * Send input to the server terminal.
	 */
	private _sendInput(data: string): void {
		if (this._ws && this._ws.readyState === WebSocket.OPEN) {
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
		if (this._ws && this._ws.readyState === WebSocket.OPEN) {
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
			this._ws.close();
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
