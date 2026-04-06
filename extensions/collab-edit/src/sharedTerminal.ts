/*---------------------------------------------------------------------------------------------
 *  Collabrix — Shared Terminal
 *  Syncs I/O across all room users. Supports NL→shell translation,
 *  checkpoint (snapshot state) and handoff (transfer session to another user).
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as Y from 'yjs';

/** Simple NL → shell command mapping */
const NL_PATTERNS: Array<{ regex: RegExp; cmd: (m: RegExpMatchArray) => string }> = [
	{ regex: /run (?:the )?tests?(?: for (.+))?/i, cmd: m => m[1] ? `npm test -- ${m[1]}` : 'npm test' },
	{ regex: /build(?: the)?(?: project)?/i, cmd: () => 'npm run build' },
	{ regex: /install(?: deps| dependencies)?/i, cmd: () => 'npm install' },
	{ regex: /start(?: the)?(?: server| app)?/i, cmd: () => 'npm start' },
	{ regex: /show (?:git )?(?:log|history)/i, cmd: () => 'git log --oneline -20' },
	{ regex: /what changed/i, cmd: () => 'git diff --stat HEAD~1' },
	{ regex: /list files?(?: in (.+))?/i, cmd: m => `ls -la ${m[1] || '.'}` },
	{ regex: /clear(?: (?:the )?screen)?/i, cmd: () => 'clear' },
	{ regex: /show (?:running )?processes?/i, cmd: () => 'ps aux' },
	{ regex: /disk usage/i, cmd: () => 'df -h' },
];

export interface TerminalCheckpoint {
	id: string;
	createdBy: string;
	timestamp: number;
	label: string;
	/** Serialized terminal scrollback (last N lines of output) */
	scrollback: string;
}

export class SharedTerminal implements vscode.Disposable {
	private _terminal: vscode.Terminal | null = null;
	private _ws: WebSocket | null = null;
	private _writeEmitter = new vscode.EventEmitter<string>();
	private _closeEmitter = new vscode.EventEmitter<void>();
	private readonly _roomId: string;
	private readonly _serverUrl: string;
	private readonly _containerId?: string | null;
	private readonly _checkpoints: Y.Array<TerminalCheckpoint>;
	private readonly _userName: string;
	private _scrollback = '';

	constructor(
		roomId: string,
		serverUrl: string,
		containerId: string | null | undefined,
		masterDoc: Y.Doc,
		userName: string
	) {
		this._roomId = roomId;
		this._serverUrl = serverUrl.replace(/\/?$/, '/terminal');
		this._containerId = containerId;
		this._checkpoints = masterDoc.getArray<TerminalCheckpoint>('terminalCheckpoints');
		this._userName = userName;
	}

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
			handleInput: (data: string) => this._handleInput(data),
			setDimensions: (dim: vscode.TerminalDimensions) => this._sendResize(dim.columns, dim.rows)
		};

		this._terminal = vscode.window.createTerminal({
			name: `Shared Terminal [${this._roomId.substring(0, 8)}]`,
			pty
		});
		this._terminal.show();
	}

	/** Save current terminal scrollback as a named checkpoint in the CRDT */
	async checkpoint(): Promise<void> {
		const label = await vscode.window.showInputBox({
			prompt: 'Checkpoint label',
			placeHolder: 'e.g. after-build, pre-deploy'
		});
		if (!label) return;

		const cp: TerminalCheckpoint = {
			id: Math.random().toString(36).slice(2, 9),
			createdBy: this._userName,
			timestamp: Date.now(),
			label,
			scrollback: this._scrollback.slice(-8000) // keep last ~8KB
		};

		this._checkpoints.doc!.transact(() => {
			this._checkpoints.push([cp]);
		});

		this._writeEmitter.fire(`\r\n\x1b[36m✓ Checkpoint saved: "${label}"\x1b[0m\r\n`);
	}

	/** Restore a checkpoint — lets another user pick up where someone left off */
	async handoff(): Promise<void> {
		const all = this._checkpoints.toArray();
		if (all.length === 0) {
			vscode.window.showWarningMessage('No checkpoints saved yet. Create one first.');
			return;
		}

		const pick = await vscode.window.showQuickPick(
			all.map((cp: TerminalCheckpoint) => ({
				label: cp.label,
				description: `by ${cp.createdBy} at ${new Date(cp.timestamp).toLocaleTimeString()}`,
				cp
			})),
			{ placeHolder: 'Select a checkpoint to restore' }
		);
		if (!pick) return;

		this.open();
		this._writeEmitter.fire(
			`\r\n\x1b[36m↩ Restoring checkpoint: "${pick.cp.label}" (by ${pick.cp.createdBy})\x1b[0m\r\n`
		);
		this._writeEmitter.fire(pick.cp.scrollback);
		this._writeEmitter.fire('\r\n\x1b[36m─── End of checkpoint ───\x1b[0m\r\n');
	}

	// ── NL translation ──────────────────────────────────────────

	private _handleInput(data: string): void {
		// Only intercept if user typed a full line ending with Enter
		if (data === '\r') {
			// The terminal accumulates input — we can't easily buffer here
			// so NL translation is triggered via the '?' prefix convention
		}
		this._sendInput(data);
	}

	/** Translate a natural language sentence to a shell command */
	static translateNL(sentence: string): string | null {
		for (const { regex, cmd } of NL_PATTERNS) {
			const m = sentence.match(regex);
			if (m) return cmd(m);
		}
		return null;
	}

	// ── WebSocket ────────────────────────────────────────────────

	private _connect(): void {
		try {
			this._ws = new WebSocket(this._serverUrl);

			this._ws.onopen = () => {
				this._ws!.send(JSON.stringify({ type: 'terminal:join', roomId: this._roomId }));
				this._writeEmitter.fire('\r\n\x1b[32m✓ Connected to shared terminal\x1b[0m\r\n');
				this._writeEmitter.fire('\x1b[90mTip: prefix a line with "?" to use natural language, e.g. "?run the tests"\x1b[0m\r\n\r\n');

				if (this._containerId) {
					setTimeout(() => {
						this._sendInput(`docker exec -it ${this._containerId} /bin/bash\r`);
						setTimeout(() => this._sendInput('clear\r'), 300);
					}, 500);
				}
			};

			this._ws.onmessage = (event: MessageEvent) => {
				try {
					const msg = JSON.parse(event.data as string);
					if (msg.type === 'terminal:output') {
						this._scrollback += msg.data;
						this._writeEmitter.fire(msg.data);
					} else if (msg.type === 'terminal:exit') {
						this._writeEmitter.fire('\r\n\x1b[31m✗ Terminal session ended\x1b[0m\r\n');
						this._closeEmitter.fire();
					} else if (msg.type === 'terminal:nl_preview') {
						// Server echoes back the translated command for confirmation
						this._writeEmitter.fire(`\r\n\x1b[33m→ ${msg.command}\x1b[0m  (Enter to confirm, Esc to cancel)\r\n`);
					}
				} catch {
					this._writeEmitter.fire(event.data as string);
				}
			};

			this._ws.onerror = () => this._writeEmitter.fire('\r\n\x1b[31m✗ Terminal connection error\x1b[0m\r\n');
			this._ws.onclose = () => this._writeEmitter.fire('\r\n\x1b[33m⚠ Terminal disconnected\x1b[0m\r\n');
		} catch (err) {
			this._writeEmitter.fire(`\r\n\x1b[31m✗ Failed to connect: ${err}\x1b[0m\r\n`);
		}
	}

	private _sendInput(data: string): void {
		if (this._ws?.readyState === WebSocket.OPEN) {
			this._ws.send(JSON.stringify({ type: 'terminal:input', roomId: this._roomId, data }));
		}
	}

	private _sendResize(cols: number, rows: number): void {
		if (this._ws?.readyState === WebSocket.OPEN) {
			this._ws.send(JSON.stringify({ type: 'terminal:resize', roomId: this._roomId, cols, rows }));
		}
	}

	private _disconnect(): void {
		this._ws?.close();
		this._ws = null;
	}

	dispose(): void {
		this._disconnect();
		this._terminal?.dispose();
		this._terminal = null;
		this._writeEmitter.dispose();
		this._closeEmitter.dispose();
	}
}
