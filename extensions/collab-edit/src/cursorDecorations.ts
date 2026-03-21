/*---------------------------------------------------------------------------------------------
 *  Collaborative Editing Extension for VS Code
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export interface RemoteCursorInfo {
	clientId: number;
	userName: string;
	color: string;
	cursor: { line: number; ch: number };
	selection: { anchor: { line: number; ch: number }; head: { line: number; ch: number } } | null;
	fileUri: string;
}

/**
 * Renders remote user cursors and selections in the editor.
 *
 * Creates decoration types per remote user with unique colors.
 * Shows cursor position as a colored border + user label,
 * and selection highlights as semi-transparent background.
 */
export class CursorDecorationManager implements vscode.Disposable {
	/**
	 * Map of clientId → { cursorDecorationType, selectionDecorationType }
	 */
	private readonly _decorationTypes: Map<number, {
		cursor: vscode.TextEditorDecorationType;
		selection: vscode.TextEditorDecorationType;
		label: vscode.TextEditorDecorationType;
	}> = new Map();


	/**
	 * Update all remote cursor decorations.
	 */
	updateRemoteCursors(cursors: RemoteCursorInfo[]): void {
		// Group cursors by fileUri
		const cursorsByFile = new Map<string, RemoteCursorInfo[]>();
		for (const cursor of cursors) {
			const existing = cursorsByFile.get(cursor.fileUri) ?? [];
			existing.push(cursor);
			cursorsByFile.set(cursor.fileUri, existing);
		}

		// Get all visible editors
		const editors = vscode.window.visibleTextEditors;

		for (const editor of editors) {
			const fileUri = editor.document.uri.toString();
			const fileCursors = cursorsByFile.get(fileUri) ?? [];

			// Clear all decorations for clients not in this file anymore
			for (const [clientId, types] of this._decorationTypes) {
				const hasCursor = fileCursors.some(c => c.clientId === clientId);
				if (!hasCursor) {
					editor.setDecorations(types.cursor, []);
					editor.setDecorations(types.selection, []);
					editor.setDecorations(types.label, []);
				}
			}

			// Apply decorations for each remote cursor in this file
			for (const cursor of fileCursors) {
				const types = this._getOrCreateDecorationType(cursor.clientId, cursor.color, cursor.userName);

				// Cursor line decoration (thin colored border on the left)
				const cursorPos = new vscode.Position(cursor.cursor.line, cursor.cursor.ch);
				const cursorRange = new vscode.Range(cursorPos, cursorPos);
				editor.setDecorations(types.cursor, [{ range: cursorRange }]);

				// User label decoration (shown above cursor)
				editor.setDecorations(types.label, [{
					range: cursorRange,
					renderOptions: {
						before: {
							contentText: cursor.userName,
							backgroundColor: cursor.color,
							color: '#FFFFFF',
							fontWeight: 'bold',
							textDecoration: 'none; font-size: 10px; margin: 0 4px 0 0; padding: 1px 4px; border-radius: 2px',
						}
					}
				}]);

				// Selection highlight decoration
				if (cursor.selection) {
					const anchor = new vscode.Position(
						cursor.selection.anchor.line,
						cursor.selection.anchor.ch
					);
					const head = new vscode.Position(
						cursor.selection.head.line,
						cursor.selection.head.ch
					);
					const selectionRange = new vscode.Range(anchor, head);
					if (!selectionRange.isEmpty) {
						editor.setDecorations(types.selection, [{ range: selectionRange }]);
					} else {
						editor.setDecorations(types.selection, []);
					}
				} else {
					editor.setDecorations(types.selection, []);
				}
			}
		}
	}

	/**
	 * Get or create decoration types for a specific remote user.
	 */
	private _getOrCreateDecorationType(
		clientId: number,
		color: string,
		_userName: string
	): { cursor: vscode.TextEditorDecorationType; selection: vscode.TextEditorDecorationType; label: vscode.TextEditorDecorationType } {
		let types = this._decorationTypes.get(clientId);
		if (types) {
			return types;
		}

		// Cursor decoration: a thin colored border-left on the character position
		const cursor = vscode.window.createTextEditorDecorationType({
			borderWidth: '0 0 0 2px',
			borderStyle: 'solid',
			borderColor: color,
			isWholeLine: false,
		});

		// Selection decoration: semi-transparent background
		const selection = vscode.window.createTextEditorDecorationType({
			backgroundColor: this._hexToRgba(color, 0.25),
			isWholeLine: false,
		});

		// Label decoration: before pseudo-element showing username
		const label = vscode.window.createTextEditorDecorationType({
			// The actual rendering is done via renderOptions in updateRemoteCursors
		});

		types = { cursor, selection, label };
		this._decorationTypes.set(clientId, types);
		return types;
	}

	/**
	 * Convert hex color to rgba with alpha.
	 */
	private _hexToRgba(hex: string, alpha: number): string {
		const r = parseInt(hex.slice(1, 3), 16);
		const g = parseInt(hex.slice(3, 5), 16);
		const b = parseInt(hex.slice(5, 7), 16);
		return `rgba(${r}, ${g}, ${b}, ${alpha})`;
	}

	dispose(): void {
		for (const types of this._decorationTypes.values()) {
			types.cursor.dispose();
			types.selection.dispose();
			types.label.dispose();
		}
		this._decorationTypes.clear();
	}
}
