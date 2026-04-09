import * as vscode from 'vscode';
import * as Y from 'yjs';

import { YDocManager } from './yDocManager';
import { WsProvider } from './wsProvider';
import { CollabBinding } from './collabBinding';
import { AwarenessManager } from './awarenessManager';
import { CursorDecorationManager } from './cursorDecorations';
import { FileSyncManager } from './fileSyncManager';
import { SharedTerminal } from './sharedTerminal';
import { RbacManager } from './rbacManager';
import { HeatmapManager } from './heatmapManager';
import { ShadowMergeEngine } from './shadowMergeEngine';
import { ArchitectureWebview } from './architectureWebview';
import { DockerManager } from './dockerManager';
import { generateBaselineArchitecture } from './codeToDiagramSync';
import { TaskSystem } from './taskSystem';
import { DbExplorer } from './dbExplorer';
import { EmbeddedBrowser } from './embeddedBrowser';
import { ShadowQA } from './shadowQA';
import { HuddleAssistant } from './huddleAssistant';
import { AuditLogger } from './auditLogger';
import { IntentPrefetcher } from './intentPrefetcher';
import { DeploymentScanner } from './deploymentScanner';
import { ChatAgentWebview } from './chatAgentWebview';

interface RoomInfo {
	roomId: string;
	userName: string;
}


export class CollabSession implements vscode.Disposable {
	private _room: RoomInfo | null = null;
	private _masterDoc: Y.Doc | null = null;
	private _wsProvider: WsProvider | null = null;
	private _yDocManager: YDocManager | null = null;
	private _awarenessManager: AwarenessManager | null = null;
	private _cursorDecorations: CursorDecorationManager | null = null;
	private _fileSyncManager: FileSyncManager | null = null;
	private _sharedTerminal: SharedTerminal | null = null;
	private _rbacManager: RbacManager | null = null;
	private _heatmapManager: HeatmapManager | null = null;
	private _shadowMergeEngine: ShadowMergeEngine | null = null;
	private _archWebview: ArchitectureWebview | null = null;
	private _dockerManager: DockerManager | null = null;
	private _taskSystem: TaskSystem | null = null;
	private _dbExplorer: DbExplorer | null = null;
	private _embeddedBrowser: EmbeddedBrowser | null = null;
	private _shadowQAAgent: ShadowQA | null = null;
	private _huddleAssistant: HuddleAssistant | null = null;
	private _auditLogger: AuditLogger | null = null;
	private _intentPrefetcher: IntentPrefetcher | null = null;
	private _chatAgent: ChatAgentWebview | null = null;
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

		// Intent prefetcher runs globally (not room-scoped)
		this._intentPrefetcher = new IntentPrefetcher();
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

		try {
			// Generate room ID locally (no REST API needed)
			const roomId = Math.random().toString(36).substring(2, 11);

			const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
			if (workspacePath) {
				this._dockerManager = new DockerManager();
				try {
					await this._dockerManager.spinUpEnvironment(workspacePath);
				} catch (err) {
					console.log('[collab] Docker spin-up failed, continuing without isolation.');
				}
			}

			await this._joinInternal(roomId, userName);

			this._auditLogger?.record(userName, 'room:create', `roomId=${roomId}`);

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

		try {
			await this._joinInternal(roomId.trim(), userName);
			this._auditLogger?.record(userName, 'room:join', `roomId=${roomId.trim()}`);
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

		this._cleanup();
		this._auditLogger?.record(this._room?.userName ?? 'unknown', 'room:leave', `roomId=${this._room?.roomId}`);
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

		if (this._awarenessManager) {
			const users = this._awarenessManager.getStates();
			const names = Array.from(users.values()).map(s => s.user?.name || 'Anonymous');
			vscode.window.showInformationMessage(`Active users: ${names.join(', ')}`);
		} else {
			vscode.window.showWarningMessage('User list not ready.');
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

		if (!this._sharedTerminal) {
			this._sharedTerminal = new SharedTerminal(
				this._room.roomId,
				serverUrl,
				this._dockerManager?.containerId,
				this._masterDoc!,
				this._room.userName
			);
		}
		this._sharedTerminal.open();
		this._auditLogger?.record(this._room.userName, 'terminal:command', 'opened shared terminal');
	}

	/** Save a terminal checkpoint */
	async checkpointTerminal(): Promise<void> {
		if (!this._sharedTerminal) {
			vscode.window.showWarningMessage('Open the shared terminal first.');
			return;
		}
		await this._sharedTerminal.checkpoint();
		this._auditLogger?.record(this._room!.userName, 'terminal:checkpoint', 'checkpoint saved');
	}

	/** Restore a terminal checkpoint (handoff) */
	async handoffTerminal(): Promise<void> {
		if (!this._room) {
			vscode.window.showWarningMessage('Not in a room.');
			return;
		}
		// Ensure terminal exists so handoff can open it
		const config = vscode.workspace.getConfiguration('collab');
		const serverUrl = config.get<string>('serverUrl', 'ws://localhost:4000');
		if (!this._sharedTerminal) {
			this._sharedTerminal = new SharedTerminal(
				this._room.roomId,
				serverUrl,
				this._dockerManager?.containerId,
				this._masterDoc!,
				this._room.userName
			);
		}
		await this._sharedTerminal.handoff();
		this._auditLogger?.record(this._room.userName, 'terminal:handoff', 'checkpoint restored');
	}

	/** Show the audit log output channel */
	showAuditLog(): void {
		if (!this._auditLogger) {
			vscode.window.showWarningMessage('Join a room first to view the audit log.');
			return;
		}
		this._auditLogger.show();
	}

	/** Manually trigger the intent prefetcher */
	async prefetchDependencies(): Promise<void> {
		await this._intentPrefetcher?.runManual();
	}

	/** Run Deployment AI Audit */
	async runDeployScan(): Promise<void> {
		if (!this._room) {
			vscode.window.showWarningMessage('Not in a room.');
			return;
		}
		const config = vscode.workspace.getConfiguration('collab');
		const claudeKey = config.get<string>('claudeApiKey');
		const openAiKey = config.get<string>('openAiApiKey');
		
		const deployScanner = new DeploymentScanner(claudeKey, openAiKey);
		await deployScanner.runScan();
	}

	/** Open the Custom AI Chat Agent */
	openChatAgent(): void {
		if (!this._room) {
			vscode.window.showWarningMessage('Not in a room.');
			return;
		}
		const config = vscode.workspace.getConfiguration('collab');
		const claudeKey = config.get<string>('claudeApiKey');
		const openAiKey = config.get<string>('openAiApiKey');

		if (!this._chatAgent) {
			this._chatAgent = new ChatAgentWebview(claudeKey, openAiKey, () => {
				this._chatAgent = null;
			});
		} else {
			this._chatAgent.reveal();
		}
	}

	/**
	 * Open the live Mermaid.js Team Brain System Architect webview.
	 */
	showArchitecture(): void {
		if (!this._room) {
			vscode.window.showWarningMessage('Not in a room. Cannot show architecture.');
			return;
		}

		if (!this._archWebview) {
			this._archWebview = new ArchitectureWebview(this._masterDoc!, () => {
				this._archWebview = null;
			});
		} else {
			this._archWebview.reveal();
		}
	}

	/**
	 * Admin Command: Assign restricted roles to room users.
	 */
	async assignPermission(): Promise<void> {
		if (!this._room || !this._rbacManager) {
			vscode.window.showWarningMessage('Not in a room. You cannot assign permissions.');
			return;
		}

		const users = this._rbacManager.getAllUsers();
		const myState = users.find(u => u.userId === this._room!.userName);

		if (myState?.role !== 'admin') {
			vscode.window.showErrorMessage('Only room admins can assign permissions!');
			return;
		}

		const targetUserId = await vscode.window.showQuickPick(users.map(u => u.userId), {
			placeHolder: 'Select a user to update permissions'
		});

		if (!targetUserId) return;

		const role = await vscode.window.showQuickPick(['admin', 'contributor', 'restricted'] as const, {
			placeHolder: `Select new role for ${targetUserId}`
		});

		if (!role) return;

		let accessInput = undefined;
		if (role === 'admin') {
			accessInput = '*';
		} else {
			accessInput = await vscode.window.showInputBox({
				prompt: 'Enter allowed paths comma-separated (use * for all files)',
				placeHolder: 'e.g. *, backend, frontend/src/components'
			});
		}

		if (accessInput === undefined) return;

		const access = accessInput.split(',').map(s => s.trim()).filter(s => s.length > 0);

		this._rbacManager.updateUserAccess(
			targetUserId,
			role as 'admin' | 'contributor' | 'restricted',
			access.length > 0 ? access : ['*']
		);
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

		// Set up RBAC manager
		this._rbacManager = new RbacManager(this._masterDoc, userName);

		// Set up advanced Phase 3 awareness
		this._heatmapManager = new HeatmapManager(this._masterDoc);
		this._shadowMergeEngine = new ShadowMergeEngine(this._wsProvider.awareness!, userName);

		// Bootstrap foundational architecture diagram if needed (Phase 4)
		const archText = this._masterDoc.getText('architecture');
		generateBaselineArchitecture(archText, this._masterDoc);

		// Phase 6 Integrations
		this._taskSystem = new TaskSystem(this._masterDoc);
		this._dbExplorer = new DbExplorer(this._masterDoc);
		this._embeddedBrowser = new EmbeddedBrowser(this._masterDoc);

		// Phase 7 AI Integrations
		this._shadowQAAgent = new ShadowQA();
		this._huddleAssistant = new HuddleAssistant(this._masterDoc);

		// Audit logger + intent prefetcher
		this._auditLogger = new AuditLogger(this._masterDoc);

		// Set up file sync manager
		this._fileSyncManager = new FileSyncManager(
			this._masterDoc,
			this._yDocManager,
			this._wsProvider,
			this._bindings,
			this._rbacManager
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
		const binding = new CollabBinding(document, ytext, ydoc, this._rbacManager || undefined);
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
		const inspect = config.inspect<string>('userName');
		
		// For local testing, we intentionally ignore the Global (User) setting 
		// and ONLY read the Workspace setting, so different folders can have different names.
		let name = inspect?.workspaceValue || inspect?.workspaceFolderValue;

		if (!name) {
			name = await vscode.window.showInputBox({
				prompt: 'Enter your display name for THIS workspace',
				placeHolder: 'e.g., Alice',
				validateInput: (v) => v.trim().length === 0 ? 'Name is required' : null
			}) ?? '';

			if (name) {
				await config.update('userName', name, vscode.ConfigurationTarget.Workspace);
			}
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

		// Dispose RBAC & Awareness modules
		this._rbacManager?.dispose();
		this._rbacManager = null;

		this._heatmapManager?.dispose();
		this._heatmapManager = null;

		this._shadowMergeEngine?.dispose();
		this._shadowMergeEngine = null;

		this._archWebview?.dispose();
		this._archWebview = null;

		// Clean up isolated Docker environment
		this._dockerManager?.destroyEnvironment();
		this._dockerManager = null;

		// Clean up Phase 6 integrations
		this._taskSystem?.dispose();
		this._taskSystem = null;
		this._dbExplorer?.dispose();
		this._dbExplorer = null;
		this._embeddedBrowser?.dispose();
		this._embeddedBrowser = null;

		// Clean up Phase 7 Integrations
		this._shadowQAAgent?.dispose();
		this._shadowQAAgent = null;
		this._huddleAssistant?.dispose();
		this._huddleAssistant = null;

		// Audit + prefetcher
		this._auditLogger?.dispose();
		this._auditLogger = null;

		this._chatAgent?.dispose();
		this._chatAgent = null;

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

		this._intentPrefetcher?.dispose();
		this._intentPrefetcher = null;

		this._statusBarItem.dispose();
	}
}
