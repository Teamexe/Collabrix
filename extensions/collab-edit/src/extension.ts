/*---------------------------------------------------------------------------------------------
 *  Collaborative Editing Extension for VS Code
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { CollabSession } from './collabSession';

let session: CollabSession | undefined;

/**
 * Extension activation — registers all collab commands.
 */
export function activate(context: vscode.ExtensionContext): void {
	console.log('[collab] Collaborative Editing extension activated');

	session = new CollabSession();
	context.subscriptions.push(session);

	context.subscriptions.push(
		vscode.commands.registerCommand('collab.createRoom', () => session!.createRoom()),
		vscode.commands.registerCommand('collab.joinRoom', () => session!.joinRoom()),
		vscode.commands.registerCommand('collab.leaveRoom', () => session!.leaveRoom()),
		vscode.commands.registerCommand('collab.showUsers', () => session!.showActiveUsers()),
		vscode.commands.registerCommand('collab.openSharedTerminal', () => session!.openSharedTerminal()),
		vscode.commands.registerCommand('collab.assignPermission', () => session!.assignPermission()),
		vscode.commands.registerCommand('collab.showArchitecture', () => session!.showArchitecture()),
		vscode.commands.registerCommand('collab.checkpointTerminal', () => session!.checkpointTerminal()),
		vscode.commands.registerCommand('collab.handoffTerminal', () => session!.handoffTerminal()),
		vscode.commands.registerCommand('collab.showAuditLog', () => session!.showAuditLog()),
		vscode.commands.registerCommand('collab.prefetchDeps', () => session!.prefetchDependencies()),
	);
}

/**
 * Extension deactivation — clean up.
 */
export function deactivate(): void {
	if (session) {
		session.dispose();
		session = undefined;
	}
	console.log('[collab] Collaborative Editing extension deactivated');
}
