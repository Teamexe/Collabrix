/*---------------------------------------------------------------------------------------------
 *  Collaborative Editing Extension for VS Code
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as Y from 'yjs';
import type { YDocManager } from './yDocManager';
import type { WsProvider } from './wsProvider';
import type { CollabBinding } from './collabBinding';
import type { RbacManager } from './rbacManager';

/**
 * Cross-user file system synchronization.
 *
 * Maintains a root Y.Map tracking EXACT physical file state.
 * Broadcasts file create/delete/rename events so remote users
 * instantly realize physical structural changes via WorkspaceEdit.
 */
export class FileSyncManager implements vscode.Disposable {
	private readonly _disposables: vscode.Disposable[] = [];
	private readonly _masterDoc: Y.Doc;
	private readonly _fsMap: Y.Map<string>; // key: relativePath, val: base64 content or "DIR"
	private readonly _rbacManager?: RbacManager;
	
	// Guard against infinite loop reflections when applying remote changes
	private _isApplyingRemote: boolean = false;
	private _syncInterval: ReturnType<typeof setInterval> | null = null;

	constructor(
		masterDoc: Y.Doc,
		_yDocManager: YDocManager,
		_wsProvider: WsProvider,
		_bindings: Map<string, CollabBinding>,
		rbacManager?: RbacManager
	) {
		this._masterDoc = masterDoc;
		this._fsMap = masterDoc.getMap<string>('fsMap');
		this._rbacManager = rbacManager;
	}

	/**
	 * Activate file sync listeners.
	 */
	activate(): void {
		// Listen to local VS Code workspace file system events
		this._disposables.push(
			vscode.workspace.onDidCreateFiles((e) => this._onLocalFilesCreated(e)),
			vscode.workspace.onDidDeleteFiles((e) => this._onLocalFilesDeleted(e)),
			vscode.workspace.onDidRenameFiles((e) => this._onLocalFilesRenamed(e))
		);

		// Backup: catch file saves (covers Ctrl+N → Save As, or external file creation)
		this._disposables.push(
			vscode.workspace.onDidSaveTextDocument((doc) => {
				if (this._isApplyingRemote) return;
				if (doc.uri.scheme !== 'file') return;
				this._syncSingleFileToRemote(doc.uri);
			})
		);

		// Backup: FileSystemWatcher catches ANY file created on disk
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0];
		if (workspaceRoot) {
			const watcher = vscode.workspace.createFileSystemWatcher(
				new vscode.RelativePattern(workspaceRoot, '**/*'),
				false, true, false // watch creates and deletes, ignore changes
			);
			watcher.onDidCreate((uri) => {
				if (this._isApplyingRemote) return;
				this._syncSingleFileToRemote(uri);
			});
			watcher.onDidDelete((uri) => {
				if (this._isApplyingRemote) return;
				const relPath = vscode.workspace.asRelativePath(uri, false);
				if (this._fsMap.has(relPath)) {
					this._masterDoc.transact(() => {
						this._fsMap.delete(relPath);
					});
					console.log(`[collab] Watcher: deleted ${relPath} from CRDT`);
				}
			});
			this._disposables.push(watcher);
		}

		// Observe remote Y.js file map changes (for live updates during session)
		this._fsMap.observe((e) => this._onRemoteFsChange(e));

		// Scan initial workspace to populate fsMap (host populates for joiners)
		this._buildInitialFsMap();

		// After a delay, sync any files from the CRDT that don't exist locally.
		setTimeout(() => this._syncRemoteFilesToLocal(), 3000);

		// Poll every 5 seconds to catch any missed file changes
		this._syncInterval = setInterval(() => this._syncRemoteFilesToLocal(), 5000);

		console.log('[collab] FileSyncManager activated for real-time physical sync');
	}

	/**
	 * Sync a single local file to the CRDT map.
	 * Used by the watcher and save listener as a fallback.
	 */
	private async _syncSingleFileToRemote(uri: vscode.Uri): Promise<void> {
		const relPath = vscode.workspace.asRelativePath(uri, false);
		// Skip node_modules, .git, etc.
		if (relPath.includes('node_modules') || relPath.includes('.git')) return;

		try {
			const stat = await vscode.workspace.fs.stat(uri);
			if (stat.type === vscode.FileType.Directory) {
				if (!this._fsMap.has(relPath)) {
					this._masterDoc.transact(() => this._fsMap.set(relPath, "DIR"));
				}
			} else {
				const data = await vscode.workspace.fs.readFile(uri);
				const base64 = Buffer.from(data).toString('base64');
				const existing = this._fsMap.get(relPath);
				if (existing !== base64) {
					this._masterDoc.transact(() => this._fsMap.set(relPath, base64));
					console.log(`[collab] Synced file to CRDT: ${relPath}`);
				}
			}
		} catch (err) {
			console.error(`[collab] Failed to sync file ${relPath}:`, err);
		}
	}

	/**
	 * Materialize all files from the CRDT map that don't exist locally.
	 * This runs once after joining to catch the initial state sync.
	 */
	private async _syncRemoteFilesToLocal(): Promise<void> {
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
		if (!workspaceRoot) return;

		this._isApplyingRemote = true;

		let created = 0;
		let deleted = 0;
		try {
			// 1. Create files/folders that exist in CRDT but not locally
			for (const [relPath, content] of this._fsMap.entries()) {
				const targetUri = vscode.Uri.joinPath(workspaceRoot, relPath);

				try {
					await vscode.workspace.fs.stat(targetUri);
					continue; // Already exists, skip
				} catch {
					// Doesn't exist locally — create it
				}

				if (content === "DIR") {
					await vscode.workspace.fs.createDirectory(targetUri);
					created++;
				} else {
					const bytes = content && content.length > 0
						? Buffer.from(content, 'base64')
						: Buffer.from('');
					await vscode.workspace.fs.writeFile(targetUri, Uint8Array.from(bytes));
					created++;
				}
			}

			// 2. Delete local files/folders that were removed from CRDT
			// Scan files
			const localFiles = await vscode.workspace.findFiles(
				new vscode.RelativePattern(workspaceRoot, '**/*'),
				'{**/node_modules/**,**/.git/**,**/dist/**,**/out/**}',
				500
			);

			for (const localFile of localFiles) {
				const relPath = vscode.workspace.asRelativePath(localFile, false);
				if (!this._fsMap.has(relPath)) {
					try {
						await vscode.workspace.fs.delete(localFile);
						deleted++;
						console.log(`[collab] Deleted local file: ${relPath}`);
					} catch { /* ignore */ }
				}
			}

			// Scan folders and delete empty ones not in CRDT
			const localDirs = await this._findLocalDirs(workspaceRoot);
			// Process deepest first so child folders are deleted before parents
			localDirs.sort((a, b) => b.length - a.length);
			for (const dirRelPath of localDirs) {
				if (!this._fsMap.has(dirRelPath)) {
					const dirUri = vscode.Uri.joinPath(workspaceRoot, dirRelPath);
					try {
						const children = await vscode.workspace.fs.readDirectory(dirUri);
						if (children.length === 0) {
							await vscode.workspace.fs.delete(dirUri, { recursive: true });
							deleted++;
							console.log(`[collab] Deleted empty local folder: ${dirRelPath}`);
						}
					} catch { /* ignore */ }
				}
			}

			if (created > 0 || deleted > 0) {
				const parts = [];
				if (created > 0) parts.push(`${created} created`);
				if (deleted > 0) parts.push(`${deleted} deleted`);
				console.log(`[collab] File sync: ${parts.join(', ')}`);
				vscode.window.showInformationMessage(`📂 File sync: ${parts.join(', ')}`);
			}
		} catch (err) {
			console.error('[collab] Error syncing remote files:', err);
		} finally {
			setTimeout(() => { this._isApplyingRemote = false; }, 300);
		}
	}

	/**
	 * Recursively find all directories under a root (relative paths).
	 */
	private async _findLocalDirs(root: vscode.Uri, prefix = ''): Promise<string[]> {
		const dirs: string[] = [];
		try {
			const entries = await vscode.workspace.fs.readDirectory(root);
			for (const [name, type] of entries) {
				if (type === vscode.FileType.Directory) {
					if (['node_modules', '.git', 'dist', 'out'].includes(name)) continue;
					const relPath = prefix ? `${prefix}/${name}` : name;
					dirs.push(relPath);
					const childDirs = await this._findLocalDirs(
						vscode.Uri.joinPath(root, name), relPath
					);
					dirs.push(...childDirs);
				}
			}
		} catch { /* ignore */ }
		return dirs;
	}

	/**
	 * Fired when user creates files/folders locally.
	 */
	private async _onLocalFilesCreated(e: vscode.FileCreateEvent): Promise<void> {
		if (this._isApplyingRemote) {
			return;
		}

		for (const fileUri of e.files) {
			const relPath = vscode.workspace.asRelativePath(fileUri, false);

			if (this._rbacManager && !this._rbacManager.hasAccess(this._rbacManager.currentUser, relPath)) {
				vscode.window.showWarningMessage(`Access Restricted. You cannot create ${relPath}. Reverting.`);
				// Since we are frontend only, we rely on the workspace edit to undo it, or just drop it.
				vscode.workspace.fs.delete(fileUri, { recursive: true });
				continue;
			}

			try {
				const stat = await vscode.workspace.fs.stat(fileUri);
				const relPath = vscode.workspace.asRelativePath(fileUri, false);
				
				if (stat.type === vscode.FileType.Directory) {
					this._masterDoc.transact(() => {
						this._fsMap.set(relPath, "DIR");
					});
				} else {
					// Read initial content to broadcast instantly
					const data = await vscode.workspace.fs.readFile(fileUri);
					const base64Content = Buffer.from(data).toString('base64');
					this._masterDoc.transact(() => {
						this._fsMap.set(relPath, base64Content);
					});
				}
				console.log(`[collab] Local File Created & Broadcast: ${relPath}`);
			} catch (err) {
				console.error(`[collab] Failed to sync created file ${fileUri}:`, err);
			}
		}
	}

	/**
	 * Fired when user deletes files/folders locally.
	 */
	private _onLocalFilesDeleted(e: vscode.FileDeleteEvent): void {
		if (this._isApplyingRemote) {
			return;
		}

		this._masterDoc.transact(() => {
			for (const fileUri of e.files) {
				const relPath = vscode.workspace.asRelativePath(fileUri, false);
				
				if (this._rbacManager && !this._rbacManager.hasAccess(this._rbacManager.currentUser, relPath)) {
					vscode.window.showErrorMessage(`Access Restricted. You cannot delete ${relPath}. Refresh required.`);
					continue;
				}

				// Deleting a folder locally fires one event for the root. 
				// We must recursively delete all nested Y.Map keys that start with relPath + '/'.
				const keysToDelete: string[] = [];
				for (const key of this._fsMap.keys()) {
					if (key === relPath || key.startsWith(`${relPath}/`)) {
						keysToDelete.push(key);
					}
				}

				for (const key of keysToDelete) {
					this._fsMap.delete(key);
				}
				console.log(`[collab] Local File Deleted & Broadcast: ${relPath}`);
			}
		});
	}

	/**
	 * Fired when user renames/moves files locally.
	 */
	private _onLocalFilesRenamed(e: vscode.FileRenameEvent): void {
		if (this._isApplyingRemote) {
			return;
		}

		this._masterDoc.transact(() => {
			for (const rename of e.files) {
				const oldRel = vscode.workspace.asRelativePath(rename.oldUri, false);
				const newRel = vscode.workspace.asRelativePath(rename.newUri, false);

				if (this._rbacManager) {
					if (!this._rbacManager.hasAccess(this._rbacManager.currentUser, oldRel) || !this._rbacManager.hasAccess(this._rbacManager.currentUser, newRel)) {
						vscode.window.showErrorMessage(`Access Restricted. You cannot rename ${oldRel}. Reverting locally.`);
						vscode.workspace.fs.rename(rename.newUri, rename.oldUri);
						continue;
					}
				}

				const keysToMove: { oldK: string, newK: string, val: string }[] = [];
				
				for (const [key, val] of this._fsMap.entries()) {
					if (key === oldRel) {
						keysToMove.push({ oldK: key, newK: newRel, val });
					} else if (key.startsWith(`${oldRel}/`)) {
						const subPath = key.substring(oldRel.length);
						keysToMove.push({ oldK: key, newK: `${newRel}${subPath}`, val });
					}
				}

				for (const move of keysToMove) {
					this._fsMap.set(move.newK, move.val);
					this._fsMap.delete(move.oldK);
				}
				console.log(`[collab] Local File Renamed & Broadcast: ${oldRel} -> ${newRel}`);
			}
		});
	}

	/**
	 * Handle remote path mutations originating from CRDT events.
	 */
	private async _onRemoteFsChange(event: Y.YMapEvent<string>): Promise<void> {
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
		if (!workspaceRoot) {
			return;
		}

		this._isApplyingRemote = true;

		try {
			const edit = new vscode.WorkspaceEdit();

			for (const [key, change] of event.changes.keys) {
				const targetUri = vscode.Uri.joinPath(workspaceRoot, key);

				if (change.action === 'add' || change.action === 'update') {
					const val = this._fsMap.get(key);
					if (val === "DIR") {
						// WorkspaceEdit doesn't have an explicit createDirectory, but creating a 
						// dummy file and deleting it or just relying on fs API works best.
						await vscode.workspace.fs.createDirectory(targetUri);
						console.log(`[collab] Remote Created DIR on disk: ${key}`);
					} else if (val !== undefined) {
						// Write physical file with contents
						const content = Buffer.from(val, 'base64');
						edit.createFile(targetUri, { overwrite: true, contents: Uint8Array.from(content) });
						console.log(`[collab] Remote Created FILE on disk: ${key}`);
					}
				} else if (change.action === 'delete') {
					edit.deleteFile(targetUri, { recursive: true, ignoreIfNotExists: true });
					console.log(`[collab] Remote Deleted FILE/DIR on disk: ${key}`);
				}
			}

			if (edit.size > 0) {
				await vscode.workspace.applyEdit(edit);
			}

		} catch (err) {
			console.error('[collab] Error applying remote FS changes:', err);
		} finally {
			// Small debounce to let VS Code's local FileSystemWatchers settle 
			// before we un-pause our upload listeners. Otherwise, the physical write
			// triggers a local event that we echo back endlessly.
			setTimeout(() => {
				this._isApplyingRemote = false;
			}, 150);
		}
	}

	/**
	 * Dump initial local workspace file paths into the Shared Map 
	 * (so new users instantly get a copy of the host's structure).
	 */
	private async _buildInitialFsMap(): Promise<void> {
		if (this._fsMap.size > 0) {
			return; // Room already populated by another user
		}

		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders) return;

		try {
			// Scan files
			const files = await vscode.workspace.findFiles(
				new vscode.RelativePattern(workspaceFolders[0], '**/*'),
				'{**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/*.png,**/*.jpg,**/*.exe}',
				500
			);

			for (const file of files) {
				const relativePath = vscode.workspace.asRelativePath(file, false);
				if (!this._fsMap.has(relativePath)) {
					try {
						const data = await vscode.workspace.fs.readFile(file);
						const base64Content = Buffer.from(data).toString('base64');
						this._masterDoc.transact(() => {
							this._fsMap.set(relativePath, base64Content);
						});
					} catch {
						this._masterDoc.transact(() => {
							this._fsMap.set(relativePath, "");
						});
					}
				}
			}

			// Scan folders (including empty ones)
			const dirs = await this._findLocalDirs(workspaceFolders[0].uri);
			for (const dirPath of dirs) {
				if (!this._fsMap.has(dirPath)) {
					this._masterDoc.transact(() => {
						this._fsMap.set(dirPath, "DIR");
					});
				}
			}

			console.log(`[collab] Initialized ${files.length} files + ${dirs.length} folders into CRDT map.`);
		} catch (err) {
			console.error('[collab] Failed to build initial fsMap:', err);
		}
	}

	dispose(): void {
		if (this._syncInterval) {
			clearInterval(this._syncInterval);
			this._syncInterval = null;
		}

		this._fsMap.unobserve(this._onRemoteFsChange);

		for (const d of this._disposables) {
			d.dispose();
		}
		this._disposables.length = 0;

		console.log('[collab] FileSyncManager disposed');
	}
}
