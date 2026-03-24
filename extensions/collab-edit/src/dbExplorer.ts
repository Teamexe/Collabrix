/*---------------------------------------------------------------------------------------------
 *  Collaborative Editing Extension for VS Code
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as Y from 'yjs';

/**
 * Shared Database query execution view.
 * Integrates an AI Safety Guardrail interceptor to prevent accidental data destruction.
 */
export class DbExplorer implements vscode.Disposable {
	private readonly _disposables: vscode.Disposable[] = [];
	private readonly _dbLogs: Y.Array<string>;
	private readonly _outputChannel: vscode.OutputChannel;

	constructor(masterDoc: Y.Doc) {
		this._dbLogs = masterDoc.getArray<string>('dbLogs');
		this._outputChannel = vscode.window.createOutputChannel('Collabrix DB Results');
		
		this._disposables.push(
			this._outputChannel,
			vscode.commands.registerCommand('collab.runDbQuery', this._runQuery.bind(this))
		);

		this._dbLogs.observe(this._onLogChange.bind(this));
	}

	private async _runQuery(): Promise<void> {
		const query = await vscode.window.showInputBox({ 
			prompt: 'Enter SQL Query to execute cluster-wide (e.g., SELECT * FROM users)',
			placeHolder: 'SELECT * FROM ...'
		});
		if (!query) return;

		// 🤖 AI Safety Guardrail Mock: Intercept destructive operations directly on the frontend
		// In a production system, this sends the query to Claude API to analyze semantic intent 
		// before allowing the database drop execution.
		if (/DROP|DELETE|TRUNCATE|ALTER/i.test(query)) {
			vscode.window.showErrorMessage(
				`🛑 AI Safety Guardrail: Destructive operations (DROP/DELETE) are blocked without Admin authorization override.`
			);
			return;
		}

		// Mock execution result to simulate data return
		const result = `[Success] Database Driver replied: Extracted 12 virtual rows for query: ${query}`;
		
		this._dbLogs.doc!.transact(() => {
			this._dbLogs.push([`>>> ${query}\n${result}\n`]);
		});

		vscode.window.showInformationMessage('Query successful -> Results available in output channel.');
		this._outputChannel.show(true);
	}

	private _onLogChange(): void {
		this._outputChannel.clear();
		for (const log of this._dbLogs.toArray()) {
			this._outputChannel.appendLine(log);
			this._outputChannel.appendLine('--------------------------------------------------');
		}
	}

	dispose(): void {
		for (const d of this._disposables) d.dispose();
	}
}
