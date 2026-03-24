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
 * Local → Remote: listens to onDidChangeTextDocument, translates change events
 *   into Y.Text insert/delete operations within a Y.Doc.transact()
 *
 * Remote → Local: observes Y.Text via ytext.observe(), converts Y.js delta ops
 *   into vscode.WorkspaceEdit applied via vscode.workspace.applyEdit()
 *
 * Uses suppress flags to prevent echo loops.
 * Normalizes all text to LF (\n) inside the CRDT to handle cross-platform
 * line-ending differences (CRLF on Windows vs LF on Linux/Mac).
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
		// Initial content synchronization:
		// - If Y.Text already has content (joining an existing room),
		//   replace the local document with the CRDT state.
		// - If Y.Text is empty (first user or new file),
		//   seed the CRDT with the local document content (normalized to LF).
		if (this._ytext.length > 0) {
			const crdtContent = this._ytext.toString();
			const localContent = this._normalize(this._document.getText());
			if (crdtContent !== localContent) {
				this._applyFullContent(crdtContent);
			}
		} else if (this._document.getText().length > 0) {
			this._ydoc.transact(() => {
				this._ytext.insert(0, this._normalize(this._document.getText()));
			}, this);
		}

		// Listen for local edits
		this._disposables.push(
			vscode.workspace.onDidChangeTextDocument(this._onLocalChange, this)
		);

		// Listen for remote CRDT changes
		this._ytext.observe(this._onRemoteChange);
	}

	// ──────────────────────── EOL Helpers ────────────────────────

	/**
	 * Normalize text to LF (\n) — this is the canonical form inside the CRDT.
	 */
	private _normalize(text: string): string {
		return text.replace(/\r\n/g, '\n');
	}

	/**
	 * Convert a document character offset (which counts \r\n as 2 chars)
	 * to a CRDT offset (which counts \n as 1 char).
	 */
	private _docOffsetToCrdtOffset(docOffset: number): number {
		if (this._document.eol === vscode.EndOfLine.LF) {
			return docOffset;
		}
		const textBefore = this._document.getText().substring(0, docOffset);
		const crlfCount = (textBefore.match(/\r\n/g) || []).length;
		return docOffset - crlfCount;
	}

	/**
	 * Convert a CRDT offset (LF-based) to a document character offset
	 * (which may use CRLF and count \r\n as 2 chars).
	 */
	private _crdtOffsetToDocOffset(crdtOffset: number): number {
		if (this._document.eol === vscode.EndOfLine.LF) {
			return crdtOffset;
		}
		const docText = this._document.getText();
		let crdt = 0;
		let doc = 0;
		while (crdt < crdtOffset && doc < docText.length) {
			if (docText[doc] === '\r' && doc + 1 < docText.length && docText[doc + 1] === '\n') {
				doc += 2;
				crdt += 1;
			} else {
				doc++;
				crdt++;
			}
		}
		return doc;
	}

	// ──────────────────────── Local → CRDT ────────────────────────

	/**
	 * Handle local VS Code document changes → push to Y.Text.
	 */
	private _onLocalChange(e: vscode.TextDocumentChangeEvent): void {
		if (e.document !== this._document) {
			return;
		}
		if (this._suppressLocalBroadcast) {
			return;
		}

		// Enforce RBAC Locks dynamically
		if (this._rbacManager) {
			const relativePath = vscode.workspace.asRelativePath(this._document.uri, false);
			if (!this._rbacManager.hasAccess(this._rbacManager.currentUser, relativePath)) {
				vscode.window.showWarningMessage(`Access Restricted by Admin! Reverting changes to ${relativePath}.`);
				
				// Revert by restoring the canonical CRDT state
				this._suppressLocalBroadcast = true;
				const crdtContent = this._ytext.toString();
				this._applyFullContent(crdtContent).finally(() => {
					this._suppressLocalBroadcast = false;
				});
				return;
			}
		}

		this._suppressRemoteApply = true;
		try {
			this._ydoc.transact(() => {
				// Process changes in reverse order to maintain correct offsets
				const sortedChanges = [...e.contentChanges].sort(
					(a, b) => b.rangeOffset - a.rangeOffset
				);

				for (const change of sortedChanges) {
					// Convert from document offsets to CRDT (LF-normalized) offsets
					const crdtOffset = this._docOffsetToCrdtOffset(change.rangeOffset);
					const crdtDeleteLen = this._normalize(
						this._document.getText().substring(0, change.rangeOffset + change.rangeLength)
					).length - this._normalize(
						this._document.getText().substring(0, change.rangeOffset)
					).length;

					if (crdtDeleteLen > 0) {
						this._ytext.delete(crdtOffset, crdtDeleteLen);
					}
					if (change.text.length > 0) {
						this._ytext.insert(crdtOffset, this._normalize(change.text));
					}
				}
			}, this);
		} finally {
			this._suppressRemoteApply = false;
		}
	}

	// ──────────────────────── CRDT → Local ────────────────────────

	/**
	 * Handle remote Y.Text changes → apply to VS Code document.
	 */
	private readonly _onRemoteChange = (event: Y.YTextEvent, transaction: Y.Transaction): void => {
		if (this._suppressRemoteApply) {
			return;
		}
		if (transaction.origin === this) {
			return;
		}

		this._suppressLocalBroadcast = true;

		const edit = new vscode.WorkspaceEdit();
		let crdtOffset = 0;

		for (const delta of event.delta) {
			if (delta.retain !== undefined) {
				crdtOffset += delta.retain;
			} else if (delta.insert !== undefined) {
				const text = typeof delta.insert === 'string' ? delta.insert : '';
				// Convert CRDT offset to document offset, then to position
				const docOffset = this._crdtOffsetToDocOffset(crdtOffset);
				const pos = this._document.positionAt(docOffset);
				// Insert with the document's native EOL
				const nativeText = this._document.eol === vscode.EndOfLine.CRLF
					? text.replace(/\n/g, '\r\n')
					: text;
				edit.insert(this._document.uri, pos, nativeText);
				crdtOffset += text.length;
			} else if (delta.delete !== undefined) {
				const docStart = this._crdtOffsetToDocOffset(crdtOffset);
				const docEnd = this._crdtOffsetToDocOffset(crdtOffset + delta.delete);
				const startPos = this._document.positionAt(docStart);
				const endPos = this._document.positionAt(docEnd);
				edit.delete(this._document.uri, new vscode.Range(startPos, endPos));
			}
		}

		vscode.workspace.applyEdit(edit).then(
			(_success) => {
				this._suppressLocalBroadcast = false;
			},
			(err) => {
				this._suppressLocalBroadcast = false;
				console.error('[collab] Failed to apply remote edit:', err);
			}
		);
	};

	// ──────────────────────── Full Sync ────────────────────────

	/**
	 * Replace the entire local document content (used for initial sync).
	 */
	private async _applyFullContent(content: string): Promise<void> {
		this._suppressLocalBroadcast = true;
		try {
			const edit = new vscode.WorkspaceEdit();
			const fullRange = new vscode.Range(
				this._document.positionAt(0),
				this._document.positionAt(this._document.getText().length)
			);
			// Convert LF content to the document's native EOL
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
		console.log(`[collab] CollabBinding disposed for ${this._document.uri.toString()}`);
	}
}
