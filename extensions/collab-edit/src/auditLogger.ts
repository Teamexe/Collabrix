/*---------------------------------------------------------------------------------------------
 *  Collabrix — Audit Logger
 *  Records every significant action in the room with timestamp + user attribution.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as Y from 'yjs';

export type AuditAction =
	| 'room:create' | 'room:join' | 'room:leave'
	| 'file:edit' | 'file:create' | 'file:delete' | 'file:rename'
	| 'terminal:command' | 'terminal:checkpoint' | 'terminal:handoff'
	| 'task:create' | 'task:complete' | 'task:assign'
	| 'rbac:update'
	| 'docker:start' | 'docker:stop';

export interface AuditEntry {
	id: string;
	timestamp: number;
	user: string;
	action: AuditAction;
	detail: string;
}

export class AuditLogger implements vscode.Disposable {
	private readonly _log: Y.Array<AuditEntry>;
	private readonly _outputChannel: vscode.OutputChannel;
	private readonly _disposables: vscode.Disposable[] = [];

	constructor(masterDoc: Y.Doc) {
		this._log = masterDoc.getArray<AuditEntry>('auditLog');
		this._outputChannel = vscode.window.createOutputChannel('Collabrix Audit Log');

		// Reflect remote entries into the output channel
		this._log.observe(() => this._refresh());

		this._disposables.push(this._outputChannel);
	}

	show(): void {
		this._refresh();
		this._outputChannel.show(true);
	}

	/** Record an action — call this from anywhere in the session */
	record(user: string, action: AuditAction, detail: string): void {
		const entry: AuditEntry = {
			id: Math.random().toString(36).slice(2, 9),
			timestamp: Date.now(),
			user,
			action,
			detail
		};
		this._log.doc!.transact(() => {
			this._log.push([entry]);
		});
	}

	/** Export the full log as JSON string */
	export(): string {
		return JSON.stringify(this._log.toArray(), null, 2);
	}

	private _refresh(): void {
		this._outputChannel.clear();
		this._outputChannel.appendLine('=== Collabrix Audit Log ===\n');
		for (const entry of this._log.toArray()) {
			const ts = new Date(entry.timestamp).toISOString();
			this._outputChannel.appendLine(
				`[${ts}] ${entry.user.padEnd(16)} ${entry.action.padEnd(22)} ${entry.detail}`
			);
		}
	}

	dispose(): void {
		for (const d of this._disposables) d.dispose();
	}
}

