/*---------------------------------------------------------------------------------------------
 *  Collaborative Editing Extension for VS Code
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as Y from 'yjs';

import { YDocManager } from './yDocManager';
import { WsProvider } from './wsProvider';
import { CollabBinding } from './collabBinding';
import { AwarenessManager } from './awarenessManager';
import { CursorDecorationManager } from './cursorDecorations';
import { FileSyncManager } from './fileSyncManager';
import { SharedTerminal } from './sharedTerminal';

interface RoomInfo {
	roomId: string;
	userName: string;
}

/**
 * Orchestrates a collaboration session.
 *
 * Manages websocket connections, Y.Doc per file, bindings, awareness,
 * shared terminals, and file sync.
 */
export class CollabSession implements vscode.Disposable {
	private _room: RoomInfo | null = null;
	private _masterDoc: Y.Doc | null = null;
	private _wsProvider: WsProvider | null = null;
	private _yDocManager: YDocManager | null = null;
	private _awarenessManager: AwarenessManager | null = null;
	private _cursorDecorations: CursorDecorationManager | null = null;
	private _fileSyncManager: FileSyncManager | null = null;
	private _sharedTerminal: SharedTerminal | null = null;
	private readonly _bindings: Map<string, CollabBinding> = new Map();
	private readonly _disposables: vscode.Disposable[] = [];
	private _statusBarItem: vscode.StatusBarItem;

	constructor() {
		this._statusBarItem = vscode.window.createStatusBarItem(
			vscode.StatusBarAlignment.Left, 100
		);
		this._statusBarItem.command = 'collab.showUsers';
		this._updateStatusBar();
		this._statusBarItem.show();
	}

	/**
	 * Create a new collaboration room.
	 */
	async createRoom(): Promise<void> {
		if (this._room) {
			vscode.window.showWarningMessage('Already in a room. Leave first.');
			return;
		}

		const userName = await this._getUserName();
		if (!userName) {
			return;
		}

		const config = vscode.workspace.getConfiguration('collab');
		const httpUrl = config.get<string>('serverHttpUrl', 'http://localhost:4000');

		try {
			// Call REST API to create room
			const response = await fetch(`${httpUrl}/api/create-room`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ hostName: userName })
			});

			if (!response.ok) {
				throw new Error(`Server returned ${response.status}`);
			}

			const data = await response.json() as { roomId: string };
			const roomId = data.roomId;

			await this._joinInternal(roomId, userName);

			// Copy room ID to clipboard and show it
			await vscode.env.clipboard.writeText(roomId);
			vscode.window.showInformationMessage(
				`Room created! ID: ${roomId} (copied to clipboard). Share this with collaborators.`
			);
		} catch (err) {
			vscode.window.showErrorMessage(
				`Failed to create room: ${err}. Make sure the collab server is running.`
			);
		}
	}

	/**
	 * Join an existing collaboration room.
	 */
	async joinRoom(): Promise<void> {
		if (this._room) {
			vscode.window.showWarningMessage('Already in a room. Leave first.');
			return;
		}

		const userName = await this._getUserName();
		if (!userName) {
			return;
		}

		const roomId = await vscode.window.showInputBox({
			prompt: 'Enter Room ID',
			placeHolder: 'e.g., abc12345-...',
			validateInput: (value) => value.trim().length === 0 ? 'Room ID is required' : null
		});

		if (!roomId) {
			return;
		}

		const config = vscode.workspace.getConfiguration('collab');
		const httpUrl = config.get<string>('serverHttpUrl', 'http://localhost:4000');

		try {
			const response = await fetch(`${httpUrl}/api/join-room`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ roomId: roomId.trim(), userName })
			});

			if (!response.ok) {
				throw new Error(`Server returned ${response.status}`);
			}

			await this._joinInternal(roomId.trim(), userName);
			vscode.window.showInformationMessage(`Joined room: ${roomId.trim()}`);
		} catch (err) {
			vscode.window.showErrorMessage(`Failed to join room: ${err}`);
		}
	}

	/**
	 * Leave the current room.
	 */
	async leaveRoom(): Promise<void> {
		if (!this._room) {
			vscode.window.showWarningMessage('Not in a room.');
			return;
		}

		const config = vscode.workspace.getConfiguration('collab');
		const httpUrl = config.get<string>('serverHttpUrl', 'http://localhost:4000');

		try {
			await fetch(`${httpUrl}/api/leave-room`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					roomId: this._room.roomId,
					userName: this._room.userName
				})
			});
		} catch {
			// Best-effort leave notification
		}

		this._cleanup();
		vscode.window.showInformationMessage('Left the collaboration room.');
	}

	/**
	 * Show active users in the current room.
	 */
	async showActiveUsers(): Promise<void> {
		if (!this._room) {
			vscode.window.showWarningMessage('Not in a room.');
			return;
		}

		const config = vscode.workspace.getConfiguration('collab');
		const httpUrl = config.get<string>('serverHttpUrl', 'http://localhost:4000');

		try {
			const response = await fetch(
				`${httpUrl}/api/active-users/${this._room.roomId}`
			);
			const data = await response.json() as { users: string[] };
			const userList = data.users.join(', ');
			vscode.window.showInformationMessage(`Active users: ${userList}`);
		} catch (err) {
			vscode.window.showErrorMessage(`Failed to fetch users: ${err}`);
		}
	}

	/**
	 * Open a shared terminal synced across all room users.
	 */
	openSharedTerminal(): void {
		if (!this._room) {
			vscode.window.showWarningMessage('Not in a room.');
			return;
		}

		const config = vscode.workspace.getConfiguration('collab');
		const serverUrl = config.get<string>('serverUrl', 'ws://localhost:4000');

		this._sharedTerminal = new SharedTerminal(
			this._room.roomId,
			serverUrl
		);
		this._sharedTerminal.open();
	}

	/**
	 * Internal: connect to a room via y-websocket and set up bindings.
	 */
	private async _joinInternal(roomId: string, userName: string): Promise<void> {
		this._room = { roomId, userName };

		// Set context for command enablement
		vscode.commands.executeCommand('setContext', 'collab.inRoom', true);

		// Create a master Y.Doc for the room
		this._masterDoc = new Y.Doc();
		this._yDocManager = new YDocManager();

		// Connect to y-websocket server
		const config = vscode.workspace.getConfiguration('collab');
		const serverUrl = config.get<string>('serverUrl', 'ws://localhost:4000');

		this._wsProvider = new WsProvider({
			serverUrl,
			roomName: roomId,
			doc: this._masterDoc
		});

		this._wsProvider.onStatusChange((_status) => {
			this._updateStatusBar();
		});

		this._wsProvider.connect();

		// Set up cursor awareness
		this._cursorDecorations = new CursorDecorationManager();
		this._awarenessManager = new AwarenessManager(
			this._wsProvider.awareness!,
			userName,
			this._cursorDecorations
		);

		// Set up file sync manager
		this._fileSyncManager = new FileSyncManager(
			this._masterDoc,
			this._yDocManager,
			this._wsProvider,
			this._bindings
		);
		this._fileSyncManager.activate();

		// Bind all currently open text documents
		for (const editor of vscode.window.visibleTextEditors) {
			this._bindDocument(editor.document);
		}

		// Listen for newly opened documents
		this._disposables.push(
			vscode.workspace.onDidOpenTextDocument((doc) => {
				this._bindDocument(doc);
			})
		);

		// Listen for closed documents
		this._disposables.push(
			vscode.workspace.onDidCloseTextDocument((doc) => {
				this._unbindDocument(doc);
			})
		);

		this._updateStatusBar();
	}

	/**
	 * Bind a document to its CRDT counterpart.
	 */
	private _bindDocument(document: vscode.TextDocument): void {
		// Skip non-file schemes (e.g., output, debug, etc.)
		if (document.uri.scheme !== 'file') {
			return;
		}

		const fileUri = document.uri.toString();
		if (this._bindings.has(fileUri)) {
			return;
		}

		if (!this._yDocManager) {
			return;
		}

		// Use workspace-relative path as the CRDT key so that
		// different instances with different workspace roots
		// (e.g. c:\collab-test-a\hello.txt vs c:\collab-test-b\hello.txt)
		// both resolve to the same CRDT room for "hello.txt".
		const relativePath = vscode.workspace.asRelativePath(document.uri, false);

		const ytext = this._yDocManager.getText(relativePath);
		const ydoc = this._yDocManager.getOrCreateDoc(relativePath);
		const binding = new CollabBinding(document, ytext, ydoc);
		this._bindings.set(fileUri, binding);

		// Connect this per-file doc to the server using relative path as room name
		const config = vscode.workspace.getConfiguration('collab');
		const serverUrl = config.get<string>('serverUrl', 'ws://localhost:4000');
		const fileRoomName = `${this._room!.roomId}:${relativePath}`;

		const fileProvider = new WsProvider({
			serverUrl,
			roomName: fileRoomName,
			doc: ydoc
		});
		fileProvider.connect();

		console.log(`[collab] Bound document: ${relativePath} (room: ${fileRoomName})`);
	}

	/**
	 * Unbind a document from its CRDT counterpart.
	 */
	private _unbindDocument(document: vscode.TextDocument): void {
		const fileUri = document.uri.toString();
		const binding = this._bindings.get(fileUri);
		if (binding) {
			binding.dispose();
			this._bindings.delete(fileUri);
		}

		if (this._yDocManager) {
			this._yDocManager.destroyDoc(fileUri);
		}
	}

	/**
	 * Get the user name from config or prompt.
	 */
	private async _getUserName(): Promise<string | undefined> {
		const config = vscode.workspace.getConfiguration('collab');
		let name = config.get<string>('userName', '');

		if (!name) {
			name = await vscode.window.showInputBox({
				prompt: 'Enter your display name',
				placeHolder: 'e.g., Alice',
				validateInput: (v) => v.trim().length === 0 ? 'Name is required' : null
			}) ?? '';
		}

		if (name) {
			await config.update('userName', name, vscode.ConfigurationTarget.Global);
		}

		return name || undefined;
	}

	/**
	 * Update the status bar item.
	 */
	private _updateStatusBar(): void {
		if (this._room) {
			const connected = this._wsProvider?.isConnected ?? false;
			const icon = connected ? '$(radio-tower)' : '$(debug-disconnect)';
			this._statusBarItem.text = `${icon} Collab: ${this._room.roomId.substring(0, 8)}...`;
			this._statusBarItem.tooltip = `Room: ${this._room.roomId}\nUser: ${this._room.userName}\nStatus: ${connected ? 'Connected' : 'Disconnected'}`;
		} else {
			this._statusBarItem.text = '$(live-share) Collab: Offline';
			this._statusBarItem.tooltip = 'Click to show users (join a room first)';
		}
	}

	/**
	 * Clean up all session resources.
	 */
	private _cleanup(): void {
		// Dispose bindings
		for (const binding of this._bindings.values()) {
			binding.dispose();
		}
		this._bindings.clear();

		// Dispose awareness
		this._awarenessManager?.dispose();
		this._awarenessManager = null;

		// Dispose cursor decorations
		this._cursorDecorations?.dispose();
		this._cursorDecorations = null;

		// Dispose file sync
		this._fileSyncManager?.dispose();
		this._fileSyncManager = null;

		// Dispose shared terminal
		this._sharedTerminal?.dispose();
		this._sharedTerminal = null;

		// Disconnect websocket
		this._wsProvider?.dispose();
		this._wsProvider = null;

		// Destroy doc manager
		this._yDocManager?.dispose();
		this._yDocManager = null;

		// Destroy master doc
		this._masterDoc?.destroy();
		this._masterDoc = null;

		// Clear context
		vscode.commands.executeCommand('setContext', 'collab.inRoom', false);

		this._room = null;
		this._updateStatusBar();
	}

	dispose(): void {
		this._cleanup();

		for (const d of this._disposables) {
			d.dispose();
		}
		this._disposables.length = 0;

		this._statusBarItem.dispose();
	}
}
