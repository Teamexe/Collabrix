/*---------------------------------------------------------------------------------------------
 *  Collaborative Editing Extension for VS Code
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * Acts as a 3rd phantom pair-programmer in the room.
 * Mocks pushing code deltas to Claude in real-time, receiving programmatic diagnostics 
 * underneath lines of code BEFORE merging.
 */
export class ShadowQA implements vscode.Disposable {
	private readonly _disposables: vscode.Disposable[] = [];
	private _diagnosticCollection: vscode.DiagnosticCollection;
	private _typingTimer: ReturnType<typeof setTimeout> | null = null;

	constructor() {
		this._diagnosticCollection = vscode.languages.createDiagnosticCollection('collabQA');
		
		this._disposables.push(
			this._diagnosticCollection,
			vscode.workspace.onDidChangeTextDocument(this._onTyping, this)
		);
		
		console.log('[collab] Shadow QA Agent active');
	}

	private _onTyping(e: vscode.TextDocumentChangeEvent): void {
		if (e.contentChanges.length === 0 || e.document.uri.scheme !== 'file') return;
		
		if (this._typingTimer) clearTimeout(this._typingTimer);
		
		// Throttle streaming code to external AI backend
		this._typingTimer = setTimeout(() => {
			this._analyzeWithClaude(e.document);
		}, 2000);
	}

	private _analyzeWithClaude(doc: vscode.TextDocument): void {
		const text = doc.getText();
		const diagnostics: vscode.Diagnostic[] = [];
		
		// Mock Claude Semantic Intelligence parsing the code payload
		const lines = text.split('\n');
		lines.forEach((line, i) => {
			// Fake Semantic Hook 1: Anti-patterns
			if (line.includes('console.log(')) {
				const range = new vscode.Range(i, line.indexOf('console.log'), i, line.length);
				const diag = new vscode.Diagnostic(
					range, 
					'🤖 [Claude QA] Debugging statement detected in production flow. Consider removing or converting to formal telemetry logging.',
					vscode.DiagnosticSeverity.Warning
				);
				diagnostics.push(diag);
			}
			// Fake Semantic Hook 2: Tech Debt Watcher
			if (line.includes('TODO')) {
				const range = new vscode.Range(i, line.indexOf('TODO'), i, line.length);
				const diag = new vscode.Diagnostic(
					range, 
					'🤖 [Claude QA] Unresolved TODO detected. Should we escalate this to the Unified Task Board?',
					vscode.DiagnosticSeverity.Information
				);
				diagnostics.push(diag);
			}
		});

		// Reflect AI feedback into local editor UI natively
		this._diagnosticCollection.set(doc.uri, diagnostics);
	}

	dispose(): void {
		if (this._typingTimer) clearTimeout(this._typingTimer);
		for (const d of this._disposables) d.dispose();
	}
}
