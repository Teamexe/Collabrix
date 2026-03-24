/*---------------------------------------------------------------------------------------------
 *  Collaborative Editing Extension for VS Code
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as Y from 'yjs';

/**
 * Tracks the overall edit volume per file across all users in the collaborative room.
 * Visually stamps hot or heavily-contested files with a 🔥 decorator.
 */
export class HeatmapManager implements vscode.FileDecorationProvider, vscode.Disposable {
	private readonly _masterDoc: Y.Doc;
	private readonly _heatMap: Y.Map<number>;
	
	private readonly _onDidChangeFileDecorations = new vscode.EventEmitter<vscode.Uri | vscode.Uri[]>();
	readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;

	private readonly _disposables: vscode.Disposable[] = [];
	private _pendingCounts = new Map<string, number>();
	private _flushInterval: ReturnType<typeof setInterval>;

	constructor(masterDoc: Y.Doc) {
		this._masterDoc = masterDoc;
		this._heatMap = masterDoc.getMap<number>('heatmap');

		this._disposables.push(
			vscode.window.registerFileDecorationProvider(this),
			vscode.workspace.onDidChangeTextDocument(this._onDocumentChanged, this)
		);

		// When the global heatmap increments remotely, reflect UI locally
		this._heatMap.observe(() => {
			this._onDidChangeFileDecorations.fire([]);
		});

		// Debounce outgoing CRDT transactions to avoid flooding the network
		this._flushInterval = setInterval(() => this._flush(), 2000);
	}

	private _onDocumentChanged(e: vscode.TextDocumentChangeEvent): void {
		if (e.contentChanges.length === 0 || e.document.uri.scheme !== 'file') return;

		const relPath = vscode.workspace.asRelativePath(e.document.uri, false);
		const current = this._pendingCounts.get(relPath) || 0;
		this._pendingCounts.set(relPath, current + e.contentChanges.length);
	}

	private _flush(): void {
		if (this._pendingCounts.size === 0) return;

		this._masterDoc.transact(() => {
			for (const [relPath, count] of this._pendingCounts.entries()) {
				const current = this._heatMap.get(relPath) || 0;
				this._heatMap.set(relPath, current + count);
			}
		});
		this._pendingCounts.clear();
	}

	provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
		if (uri.scheme !== 'file') return undefined;

		const relativePath = vscode.workspace.asRelativePath(uri, false);
		const edits = this._heatMap.get(relativePath) || 0;

		// Thresholds for rendering Heatmap Badges 
		if (edits > 100) {
			return {
				badge: '🔥',
				tooltip: `Hot File: highly contested with ${edits} recent edits`,
				color: new vscode.ThemeColor('errorForeground')
			};
		} else if (edits > 25) {
			return {
				badge: '📈',
				tooltip: `Active File: ${edits} recent edits`,
				color: new vscode.ThemeColor('warningForeground')
			};
		}
		return undefined;
	}

	dispose(): void {
		clearInterval(this._flushInterval);
		this._onDidChangeFileDecorations.dispose();
		for (const d of this._disposables) d.dispose();
	}
}
