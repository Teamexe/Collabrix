/*---------------------------------------------------------------------------------------------
 *  Collaborative Editing Extension for VS Code
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as Y from 'yjs';

/**
 * Manages Y.Doc instances — one per collaboratively-edited file.
 * Each doc contains a Y.Text named "content" that mirrors the file's text.
 */
export class YDocManager {
	private readonly _docs: Map<string, Y.Doc> = new Map();

	/**
	 * Get or create a Y.Doc for the given file URI.
	 */
	getOrCreateDoc(fileUri: string): Y.Doc {
		let doc = this._docs.get(fileUri);
		if (!doc) {
			doc = new Y.Doc();
			this._docs.set(fileUri, doc);
			console.log(`[collab] Created Y.Doc for ${fileUri}`);
		}
		return doc;
	}

	/**
	 * Get the Y.Text ("content") from a doc for the given file URI.
	 * Creates the doc if it doesn't exist.
	 */
	getText(fileUri: string): Y.Text {
		const doc = this.getOrCreateDoc(fileUri);
		return doc.getText('content');
	}

	/**
	 * Check if a doc exists for the given file URI.
	 */
	hasDoc(fileUri: string): boolean {
		return this._docs.has(fileUri);
	}

	/**
	 * Destroy a Y.Doc for the given file URI, releasing resources.
	 */
	destroyDoc(fileUri: string): void {
		const doc = this._docs.get(fileUri);
		if (doc) {
			doc.destroy();
			this._docs.delete(fileUri);
			console.log(`[collab] Destroyed Y.Doc for ${fileUri}`);
		}
	}

	/**
	 * Get all tracked file URIs.
	 */
	getTrackedFiles(): string[] {
		return Array.from(this._docs.keys());
	}

	/**
	 * Destroy all docs and clear the manager.
	 */
	dispose(): void {
		for (const doc of this._docs.values()) {
			doc.destroy();
		}
		this._docs.clear();
		console.log('[collab] YDocManager disposed');
	}
}
