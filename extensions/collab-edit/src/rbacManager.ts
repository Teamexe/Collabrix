/*---------------------------------------------------------------------------------------------
 *  Collaborative Editing Extension for VS Code
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as Y from 'yjs';

export interface RbacUser {
	userId: string;
	role: 'admin' | 'contributor' | 'restricted';
	access: string[]; // Array of allowed path prefixes, e.g. ["*"] or ["backend", "frontend/api"]
}

export class RbacManager implements vscode.FileDecorationProvider, vscode.Disposable {
	private readonly _masterDoc: Y.Doc;
	private readonly _rbacMap: Y.Map<RbacUser>;
	public readonly currentUser: string;

	private readonly _onDidChangeFileDecorations = new vscode.EventEmitter<vscode.Uri | vscode.Uri[]>();
	readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;

	private readonly _disposables: vscode.Disposable[] = [];

	constructor(masterDoc: Y.Doc, currentUser: string) {
		this._masterDoc = masterDoc;
		this._rbacMap = masterDoc.getMap<RbacUser>('rbac');
		this.currentUser = currentUser;

		// Register the FileDecorationProvider to show lock icons on restricted files
		this._disposables.push(
			vscode.window.registerFileDecorationProvider(this)
		);

		// Observe role changes to instantly update UI locks and active editors
		this._rbacMap.observe(() => {
			this._onDidChangeFileDecorations.fire([]);
			this._enforceRestrictions();
		});

		// Initialize this user in the CRDT if joining for the first time
		if (!this._rbacMap.has(currentUser)) {
			this._masterDoc.transact(() => {
				// The first user to join (create the room) is the admin.
				const isFirstUser = this._rbacMap.keys().next().done;
				this._rbacMap.set(currentUser, {
					userId: currentUser,
					role: isFirstUser ? 'admin' : 'contributor',
					access: ['*'] // Default access all. Admins can restrict later.
				});
			});
		}
	}

	/**
	 * Core RBAC enforcement logic: Can `userId` edit `targetPath`?
	 */
	hasAccess(userId: string, targetPath: string): boolean {
		const userState = this._rbacMap.get(userId);
		if (!userState) return false;

		// Admins inherently bypass all folder locks
		if (userState.role === 'admin') return true;
		if (userState.access.includes('*')) return true;

		// Prefix matching for folder-level access
		for (const allowedPath of userState.access) {
			// e.g. if allowedPath is "backend" and target is "backend/api.ts" -> access!
			if (targetPath === allowedPath || targetPath.startsWith(`${allowedPath}/`)) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Provide the 🔒 icon for files/folders the current user cannot edit.
	 */
	provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
		if (uri.scheme !== 'file') return undefined;

		const relativePath = vscode.workspace.asRelativePath(uri, false);
		if (!this.hasAccess(this.currentUser, relativePath)) {
			return {
				badge: '🔒',
				tooltip: 'Access Restricted by Room Admin',
				color: new vscode.ThemeColor('errorForeground')
			};
		}
		return undefined;
	}

	/**
	 * Actively enforce restrictions when RBAC states change maliciously or dynamically.
	 * (e.g. closes the active editor if suddenly locked out)
	 */
	private _enforceRestrictions(): void {
		const activeEditor = vscode.window.activeTextEditor;
		if (!activeEditor || activeEditor.document.uri.scheme !== 'file') return;

		const relativePath = vscode.workspace.asRelativePath(activeEditor.document.uri, false);
		if (!this.hasAccess(this.currentUser, relativePath)) {
			vscode.window.showWarningMessage(`Your access to ${relativePath} was revoked by the Admin.`);
			vscode.commands.executeCommand('workbench.action.closeActiveEditor');
		}
	}

	// ──────────────────────── Admin APIs ────────────────────────

	/**
	 * Get list of all known users to display in the assignment UI.
	 */
	getAllUsers(): RbacUser[] {
		return Array.from(this._rbacMap.values());
	}

	/**
	 * Modify a user's role or path access. Admin only.
	 */
	updateUserAccess(targetId: string, role: 'admin' | 'contributor' | 'restricted', access: string[]): void {
		const myState = this._rbacMap.get(this.currentUser);
		if (!myState || myState.role !== 'admin') {
			vscode.window.showErrorMessage('Only room admins can assign permissions.');
			return;
		}

		this._masterDoc.transact(() => {
			this._rbacMap.set(targetId, {
				userId: targetId,
				role,
				access
			});
		});
		vscode.window.showInformationMessage(`Updated access for ${targetId}.`);
	}

	dispose(): void {
		this._onDidChangeFileDecorations.dispose();
		for (const d of this._disposables) d.dispose();
	}
}
