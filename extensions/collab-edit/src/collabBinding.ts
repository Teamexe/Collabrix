/*---------------------------------------------------------------------------------------------
 *  Collaborative Editing Extension for VS Code
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as Y from 'yjs';
import type { RbacManager } from './rbacManager';

/**
 * Bidirectional binding between a VS Code TextDocument and a Y.Text CRDT.
 *
 * Key insight for correctness:
 *   - Local→CRDT: The CRDT has the OLD state, the document has the NEW state.
 *     So we read from the CRDT for offset calculations.
 *   - CRDT→Local: The CRDT has the NEW state, the document has the OLD state.
 *     So we read from the document for offset calculations.
 */
export class CollabBinding implements vscode.Disposable {
	private readonly _disposables: vscode.Disposable[] = [];
	private _suppressRemoteApply = false;
	private _suppressLocalBroadcast = false;

	constructor(
		private readonly _document: vscode.TextDocument,
		private readonly _ytext: Y.Text,
		private readonly _ydoc: Y.Doc,
		private readonly _rbacManager?: RbacManager
	) {
		// Delay initial sync to let WebSocket connect and existing CRDT state arrive
		setTimeout(() => this._initializeContent(), 1500);

		// Listen for local edits
		this._disposables.push(
			vscode.workspace.onDidChangeTextDocument(this._onLocalChange, this)
		);

		// Listen for remote CRDT changes
		this._ytext.observe(this._onRemoteChange);
	}

	private _initializeContent(): void {
		if (this._ytext.length > 0) {
			const crdtContent = this._ytext.toString();
			const localContent = this._normalize(this._document.getText());
			if (crdtContent !== localContent) {
				this._applyFullContent(crdtContent);
			}
		} else if (this._document.getText().length > 0) {
			this._suppressRemoteApply = true;
			this._ydoc.transact(() => {
				this._ytext.insert(0, this._normalize(this._document.getText()));
			}, this);
			this._suppressRemoteApply = false;
		}
	}

	// ──────────────────────── Helpers ────────────────────────

	/** Normalize text to LF — canonical form inside the CRDT. */
	private _normalize(text: string): string {
		return text.replace(/\r\n/g, '\n');
	}

	/**
	 * Convert a VS Code Position to a CRDT offset.
	 * Used in the Local→CRDT path.
	 * Reads from the CRDT text because the document is already post-edit.
	 */
	private _positionToCrdtOffset(pos: vscode.Position): number {
		const crdtText = this._ytext.toString();
		const lines = crdtText.split('\n');
		let offset = 0;
		for (let i = 0; i < pos.line && i < lines.length; i++) {
			offset += lines[i].length + 1;
		}
		if (pos.line < lines.length) {
			offset += Math.min(pos.character, lines[pos.line].length);
		}
		return offset;
	}

	/**
	 * Convert a CRDT offset to a VS Code Position.
	 * Used in the CRDT→Local path.
	 * Reads from the DOCUMENT text because the CRDT is already post-edit.
	 */
	private _crdtOffsetToDocPosition(crdtOffset: number): vscode.Position {
		if (this._document.eol === vscode.EndOfLine.LF) {
			// LF document: CRDT offset === document offset
			return this._document.positionAt(crdtOffset);
		}

		// CRLF document: walk through the document text,
		// mapping LF-based CRDT offsets to CRLF-based document offsets.
		const docText = this._document.getText();
		let crdtPos = 0;
		let docPos = 0;
		while (crdtPos < crdtOffset && docPos < docText.length) {
			if (docText[docPos] === '\r' && docPos + 1 < docText.length && docText[docPos + 1] === '\n') {
				crdtPos++; // \r\n in doc = 1 char (\n) in CRDT
				docPos += 2;
			} else {
				crdtPos++;
				docPos++;
			}
		}
		return this._document.positionAt(docPos);
	}

	// ──────────────────────── Local → CRDT ────────────────────────

	private _onLocalChange(e: vscode.TextDocumentChangeEvent): void {
		if (e.document !== this._document) {
			return;
		}
		if (this._suppressLocalBroadcast) {
			return;
		}

		// Enforce RBAC
		if (this._rbacManager) {
			const relativePath = vscode.workspace.asRelativePath(this._document.uri, false);
			if (!this._rbacManager.hasAccess(this._rbacManager.currentUser, relativePath)) {
				vscode.window.showWarningMessage(`Access Restricted! Reverting changes to ${relativePath}.`);
				this._suppressLocalBroadcast = true;
				this._applyFullContent(this._ytext.toString()).finally(() => {
					this._suppressLocalBroadcast = false;
				});
				return;
			}
		}

		this._suppressRemoteApply = true;
		try {
			this._ydoc.transact(() => {
				// Process changes in reverse offset order to keep positions stable
				const sorted = [...e.contentChanges].sort(
					(a, b) => b.rangeOffset - a.rangeOffset
				);

				for (const change of sorted) {
					// change.range refers to the OLD document state.
					// The CRDT still has OLD state → _positionToCrdtOffset is correct.
					const crdtStart = this._positionToCrdtOffset(change.range.start);
					const crdtEnd = this._positionToCrdtOffset(change.range.end);
					const deleteLen = crdtEnd - crdtStart;

					if (deleteLen > 0) {
						this._ytext.delete(crdtStart, deleteLen);
					}
					if (change.text.length > 0) {
						this._ytext.insert(crdtStart, this._normalize(change.text));
					}
				}
			}, this);
		} finally {
			this._suppressRemoteApply = false;
		}
	}

	// ──────────────────────── CRDT → Local ────────────────────────

	private readonly _onRemoteChange = (event: Y.YTextEvent, transaction: Y.Transaction): void => {
		if (this._suppressRemoteApply) {
			return;
		}
		if (transaction.origin === this) {
			return;
		}

		this._suppressLocalBroadcast = true;

		const edit = new vscode.WorkspaceEdit();

		// Delta offsets refer to positions in the OLD CRDT text.
		// The document still has OLD content → _crdtOffsetToDocPosition is correct.
		let crdtOffset = 0;

		for (const delta of event.delta) {
			if (delta.retain !== undefined) {
				crdtOffset += delta.retain;
			} else if (delta.insert !== undefined) {
				const text = typeof delta.insert === 'string' ? delta.insert : '';
				const pos = this._crdtOffsetToDocPosition(crdtOffset);
				// Convert LF → native EOL for insertion
				const nativeText = this._document.eol === vscode.EndOfLine.CRLF
					? text.replace(/\n/g, '\r\n')
					: text;
				edit.insert(this._document.uri, pos, nativeText);
				// insert does NOT advance through old text; skip in new text
				crdtOffset += text.length;
			} else if (delta.delete !== undefined) {
				const startPos = this._crdtOffsetToDocPosition(crdtOffset);
				const endPos = this._crdtOffsetToDocPosition(crdtOffset + delta.delete);
				edit.delete(this._document.uri, new vscode.Range(startPos, endPos));
				// delete advances through old text but we don't update crdtOffset
				// because the deleted chars no longer exist
			}
		}

		vscode.workspace.applyEdit(edit).then(
			() => { this._suppressLocalBroadcast = false; },
			(err) => {
				this._suppressLocalBroadcast = false;
				console.error('[collab] Failed to apply remote edit:', err);
				// Safety net: full resync on failure
				this._applyFullContent(this._ytext.toString());
			}
		);
	};

	// ──────────────────────── Full Sync ────────────────────────

	private async _applyFullContent(content: string): Promise<void> {
		this._suppressLocalBroadcast = true;
		try {
			const edit = new vscode.WorkspaceEdit();
			const fullRange = new vscode.Range(
				this._document.positionAt(0),
				this._document.positionAt(this._document.getText().length)
			);
			const nativeContent = this._document.eol === vscode.EndOfLine.CRLF
				? content.replace(/\n/g, '\r\n')
				: content;
			edit.replace(this._document.uri, fullRange, nativeContent);
			await vscode.workspace.applyEdit(edit);
		} finally {
			this._suppressLocalBroadcast = false;
		}
	}

	dispose(): void {
		this._ytext.unobserve(this._onRemoteChange);
		for (const d of this._disposables) {
			d.dispose();
		}
		this._disposables.length = 0;
	}
}
