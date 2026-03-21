/*---------------------------------------------------------------------------------------------
 *  Collaborative Editing Extension for VS Code
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as Y from 'yjs';
import type { YDocManager } from './yDocManager';
import type { WsProvider } from './wsProvider';
import type { CollabBinding } from './collabBinding';

/**
 * Cross-user file synchronization.
 *
 * Maintains a Y.Map tracking open files across users.
 * Broadcasts file open/close events so all users can see
 * which files are being collaborated on.
 */
export class FileSyncManager implements vscode.Disposable {
	private readonly _disposables: vscode.Disposable[] = [];
	private readonly _masterDoc: Y.Doc;
	private readonly _openFiles: Y.Map<boolean>;
	private readonly _fileTree: Y.Array<string>;

	constructor(
		masterDoc: Y.Doc,
		_yDocManager: YDocManager,
		_wsProvider: WsProvider,
		_bindings: Map<string, CollabBinding>
	) {
		this._masterDoc = masterDoc;
		this._openFiles = masterDoc.getMap<boolean>('openFiles');
		this._fileTree = masterDoc.getArray<string>('fileTree');
	}

	/**
	 * Activate file sync listeners.
	 */
	activate(): void {
		// Track local file open events
		this._disposables.push(
			vscode.workspace.onDidOpenTextDocument((doc) => {
				if (doc.uri.scheme === 'file') {
					this._onFileOpened(doc.uri.toString());
				}
			})
		);

		// Track local file close events
		this._disposables.push(
			vscode.workspace.onDidCloseTextDocument((doc) => {
				if (doc.uri.scheme === 'file') {
					this._onFileClosed(doc.uri.toString());
				}
			})
		);

		// Observe remote file open/close events
		this._openFiles.observe(this._onRemoteFileChange);

		// Build initial file tree from workspace
		this._buildFileTree();

		console.log('[collab] FileSyncManager activated');
	}

	/**
	 * Handle local file open → update shared state.
	 */
	private _onFileOpened(fileUri: string): void {
		this._masterDoc.transact(() => {
			this._openFiles.set(fileUri, true);
		});
		console.log(`[collab] File opened: ${fileUri}`);
	}

	/**
	 * Handle local file close → update shared state.
	 */
	private _onFileClosed(fileUri: string): void {
		this._masterDoc.transact(() => {
			this._openFiles.delete(fileUri);
		});
		console.log(`[collab] File closed: ${fileUri}`);
	}

	/**
	 * Handle remote file state changes.
	 */
	private readonly _onRemoteFileChange = (event: Y.YMapEvent<boolean>): void => {
		for (const [key, change] of event.changes.keys) {
			if (change.action === 'add') {
				console.log(`[collab] Remote user opened: ${key}`);
			} else if (change.action === 'delete') {
				console.log(`[collab] Remote user closed: ${key}`);
			}
		}
	};

	/**
	 * Get list of currently open files across all users.
	 */
	getOpenFiles(): string[] {
		const files: string[] = [];
		this._openFiles.forEach((_value, key) => {
			files.push(key);
		});
		return files;
	}

	/**
	 * Build a file tree from the workspace.
	 */
	private async _buildFileTree(): Promise<void> {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders) {
			return;
		}

		try {
			for (const folder of workspaceFolders) {
				const files = await vscode.workspace.findFiles(
					new vscode.RelativePattern(folder, '**/*'),
					'**/node_modules/**',
					500 // limit
				);

				this._masterDoc.transact(() => {
					for (const file of files) {
						const relativePath = vscode.workspace.asRelativePath(file);
						// Only add if not already in the tree
						const existingPaths = this._fileTree.toArray();
						if (!existingPaths.includes(relativePath)) {
							this._fileTree.push([relativePath]);
						}
					}
				});
			}
		} catch (err) {
			console.error('[collab] Failed to build file tree:', err);
		}
	}

	dispose(): void {
		this._openFiles.unobserve(this._onRemoteFileChange);

		for (const d of this._disposables) {
			d.dispose();
		}
		this._disposables.length = 0;

		console.log('[collab] FileSyncManager disposed');
	}
}
