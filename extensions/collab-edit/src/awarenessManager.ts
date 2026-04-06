/*---------------------------------------------------------------------------------------------
 *  Collaborative Editing Extension for VS Code
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Awareness } from 'y-protocols/awareness';
import { CursorDecorationManager, RemoteCursorInfo } from './cursorDecorations';

/**
 * Color palette for remote users (up to 8 concurrent users).
 */
const USER_COLORS = [
	'#FF6B6B', // red
	'#4ECDC4', // teal
	'#45B7D1', // blue
	'#96CEB4', // green
	'#FFEAA7', // yellow
	'#DDA0DD', // plum
	'#98D8C8', // mint
	'#F7DC6F', // gold
];

export interface AwarenessState {
	user: { name: string; color: string };
	cursor: { line: number; ch: number } | null;
	selection: { anchor: { line: number; ch: number }; head: { line: number; ch: number } } | null;
	fileUri: string | null;
}

/**
 * Manages user presence using the Y.js Awareness protocol.
 *
 * Tracks local cursor position and broadcasts it.
 * Observes remote awareness changes and updates decorations.
 */
export class AwarenessManager implements vscode.Disposable {
	private readonly _disposables: vscode.Disposable[] = [];
	private readonly _userName: string;
	private readonly _userColor: string;
	private readonly _awareness: Awareness;
	private readonly _cursorDecorations: CursorDecorationManager;

	constructor(
		awareness: Awareness,
		userName: string,
		cursorDecorations: CursorDecorationManager
	) {
		this._awareness = awareness;
		this._userName = userName;
		this._cursorDecorations = cursorDecorations;

		// Assign a color based on clientID
		this._userColor = USER_COLORS[awareness.clientID % USER_COLORS.length];

		// Set initial local awareness state
		this._awareness.setLocalState({
			user: { name: this._userName, color: this._userColor },
			cursor: null,
			selection: null,
			fileUri: null
		} as AwarenessState);

		// Listen for local cursor/selection changes
		this._disposables.push(
			vscode.window.onDidChangeTextEditorSelection(
				this._onLocalSelectionChange, this
			)
		);

		// Listen for active editor changes
		this._disposables.push(
			vscode.window.onDidChangeActiveTextEditor(
				this._onActiveEditorChange, this
			)
		);

		// Listen for remote awareness changes
		this._awareness.on('change', this._onRemoteAwarenessChange);

		console.log(`[collab] AwarenessManager initialized for "${userName}" (color: ${this._userColor})`);
	}

	/**
	 * Handle local cursor/selection changes → broadcast via awareness.
	 */
	private _onLocalSelectionChange(e: vscode.TextEditorSelectionChangeEvent): void {
		const editor = e.textEditor;
		if (editor.document.uri.scheme !== 'file') {
			return;
		}

		const selection = editor.selection;
		const state: AwarenessState = {
			user: { name: this._userName, color: this._userColor },
			cursor: { line: selection.active.line, ch: selection.active.character },
			selection: {
				anchor: { line: selection.anchor.line, ch: selection.anchor.character },
				head: { line: selection.active.line, ch: selection.active.character }
			},
			fileUri: editor.document.uri.toString()
		};

		this._awareness.setLocalState(state);
	}

	/**
	 * Handle active editor changes → update file URI in awareness.
	 */
	private _onActiveEditorChange(editor: vscode.TextEditor | undefined): void {
		if (!editor || editor.document.uri.scheme !== 'file') {
			this._awareness.setLocalStateField('fileUri', null);
			this._awareness.setLocalStateField('cursor', null);
			this._awareness.setLocalStateField('selection', null);
			return;
		}

		this._awareness.setLocalStateField(
			'fileUri',
			editor.document.uri.toString()
		);
	}

	/**
	 * Handle remote awareness changes → update cursor decorations.
	 */
	private readonly _onRemoteAwarenessChange = (): void => {
		const states = this._awareness.getStates();
		const localClientId = this._awareness.clientID;
		const remoteCursors: RemoteCursorInfo[] = [];

		states.forEach((rawState: { [x: string]: any }, clientId: number) => {
			if (clientId === localClientId) {
				return;
			}
			const state = rawState as AwarenessState;
			if (!state?.user || !state.cursor || !state.fileUri) {
				return;
			}

			remoteCursors.push({
				clientId,
				userName: state.user.name,
				color: state.user.color,
				cursor: state.cursor,
				selection: state.selection,
				fileUri: state.fileUri
			});
		});

		this._cursorDecorations.updateRemoteCursors(remoteCursors);
	};

	public getStates(): Map<number, AwarenessState> {
		return this._awareness.getStates() as Map<number, AwarenessState>;
	}

	dispose(): void {
		this._awareness.off('change', this._onRemoteAwarenessChange);

		for (const d of this._disposables) {
			d.dispose();
		}
		this._disposables.length = 0;

		console.log('[collab] AwarenessManager disposed');
	}
}
