/*---------------------------------------------------------------------------------------------
 *  Collaborative Editing Extension for VS Code
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type { Awareness } from 'y-protocols/awareness';

interface SymbolActivity {
	symbolName: string;
	filePath: string;
	timestamp: number;
}

/**
 * Predicts and warns developers about impending semantic merge conflicts.
 * Uses VS Code symbol analysis and Y.js Awareness to track what functions/classes
 * remote developers are mutating in real time.
 */
export class ShadowMergeEngine implements vscode.Disposable {
	private readonly _disposables: vscode.Disposable[] = [];
	private _activeSymbols = new Set<string>();
	private _lastReportedSymbol: string | null = null;
	private _debounceTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(
		private readonly _awareness: Awareness,
		private readonly _currentUser: string
	) {
		this._disposables.push(
			vscode.workspace.onDidChangeTextDocument(this._onTyping, this)
		);

		this._awareness.on('change', this._onAwarenessChange.bind(this));
		
		console.log('[collab] ShadowMergeEngine active');
	}

	/**
	 * Broadcast to the room which code block (Symbol) the local user is currently modifying.
	 */
	private _onTyping(e: vscode.TextDocumentChangeEvent): void {
		if (e.contentChanges.length === 0 || e.document.uri.scheme !== 'file') return;
		
		if (this._debounceTimer) clearTimeout(this._debounceTimer);
		
		const pos = e.contentChanges[0].range.start;
		
		this._debounceTimer = setTimeout(async () => {
			try {
				// Get the exact symbol tree at the user's cursor
				const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
					'vscode.executeDocumentSymbolProvider',
					e.document.uri
				);
				
				if (!symbols) return;
				
				const activeSymbol = this._findSymbolAtPosition(symbols, pos);
				if (activeSymbol && activeSymbol.name !== this._lastReportedSymbol) {
					this._lastReportedSymbol = activeSymbol.name;
					
					const activity: SymbolActivity = {
						symbolName: activeSymbol.name,
						filePath: vscode.workspace.asRelativePath(e.document.uri, false),
						timestamp: Date.now()
					};
					
					// Broadcast out via low-latency awareness protocol
					this._awareness.setLocalStateField('editingSymbol', activity);
				}
			} catch (err) {
				// Ignore if the language server isn't ready or fails
			}
		}, 750); // Small delay to let fast typers finish their thought
	}

	private _findSymbolAtPosition(symbols: vscode.DocumentSymbol[], pos: vscode.Position): vscode.DocumentSymbol | undefined {
		for (const sym of symbols) {
			if (sym.range.contains(pos)) {
				// Drill down to the most specific nested symbol (e.g. inner function)
				const childMatch = this._findSymbolAtPosition(sym.children || [], pos);
				return childMatch || sym;
			}
		}
		return undefined;
	}

	/**
	 * Listen to remote collaborators. If they are altering a function signature
	 * that exists in our current active file, raise a proactive warning.
	 */
	private _onAwarenessChange(): void {
		const states = this._awareness.getStates();
		const activeEditor = vscode.window.activeTextEditor;
		
		if (!activeEditor || activeEditor.document.uri.scheme !== 'file') return;

		const myRelPath = vscode.workspace.asRelativePath(activeEditor.document.uri, false);
		const myText = activeEditor.document.getText();

		for (const [clientId, state] of states.entries()) {
			if (clientId === this._awareness.clientID || !state.editingSymbol || !state.user) continue;

			const activity = state.editingSymbol as SymbolActivity;
			
			// Only care about extremely recent active mutations
			if (Date.now() - activity.timestamp > 15000) continue; 
			
			const uniqueId = `${state.user.name}:${activity.symbolName}`;
			
			if (!this._activeSymbols.has(uniqueId)) {
				this._activeSymbols.add(uniqueId);
				
				// Impact Heuristic: If they are editing a symbol in another file, 
				// and our active file contains references to that name, WARN us!
				if (activity.filePath !== myRelPath && myText.includes(activity.symbolName)) {
					vscode.window.showInformationMessage(
						`⚠️ Semantic Conflict Warning: ${state.user.name} is mutating '${activity.symbolName}' in a different file.`
					);
				}
				
				// Prevent spamming the toast
				setTimeout(() => {
					this._activeSymbols.delete(uniqueId);
				}, 20000);
			}
		}
	}

	dispose(): void {
		if (this._debounceTimer) clearTimeout(this._debounceTimer);
		this._awareness.off('change', this._onAwarenessChange.bind(this));
		for (const d of this._disposables) d.dispose();
	}
}
