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

		// Observe remote Y.js file map changes
		this._fsMap.observe((e) => this._onRemoteFsChange(e));

		// Scan initial workspace to populate fsMap (optional late-join sync)
		this._buildInitialFsMap();

		console.log('[collab] FileSyncManager activated for real-time physical sync');
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
			return; // Room already populated
		}

		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders) return;

		try {
			const files = await vscode.workspace.findFiles(
				new vscode.RelativePattern(workspaceFolders[0], '**/*'),
				'**/node_modules/**',
				1000
			);

			this._masterDoc.transact(() => {
				for (const file of files) {
					const relativePath = vscode.workspace.asRelativePath(file, false);
					if (!this._fsMap.has(relativePath)) {
						this._fsMap.set(relativePath, ""); 
					}
				}
			});
			console.log(`[collab] Initialized ${files.length} paths into CRDT map.`);
		} catch (err) {
			console.error('[collab] Failed to build initial fsMap:', err);
		}
	}

	dispose(): void {
		this._fsMap.unobserve(this._onRemoteFsChange);

		for (const d of this._disposables) {
			d.dispose();
		}
		this._disposables.length = 0;

		console.log('[collab] FileSyncManager disposed');
	}
}
