/*---------------------------------------------------------------------------------------------
 *  Collaborative Editing Extension for VS Code
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as Y from 'yjs';

/**
 * Scans the local workspace for source code modules and builds a baseline
 * Mermaid.js diagram to initialize the shared Architecture CRDT.
 */
export async function generateBaselineArchitecture(ytext: Y.Text, masterDoc: Y.Doc): Promise<void> {
	if (ytext.length > 0) return; // Ecosystem is already mapped by another user

	const files = await vscode.workspace.findFiles('**/*.{ts,js,py,go,java,rs}', '**/node_modules/**');
	if (files.length === 0) {
		masterDoc.transact(() => ytext.insert(0, 'graph TD;\n    App-->API;'));
		return;
	}

	// Scaffold basic module nodes
	let mmd = 'graph TD;\n';
	mmd += '    subgraph Workspace Modules\n';
	
	const nodes = new Set<string>();
	
	// Limit to top 15 files to prevent overwhelming the initial graph view
	files.slice(0, 15).forEach(f => {
		const name = f.path.split('/').pop()?.replace(/[^a-zA-Z0-9]/g, '_') || 'Module';
		nodes.add(name);
		mmd += `    ${name}[${f.path.split('/').pop()}]\n`;
	});
	mmd += '    end\n\n';

	// Connect modules loosely to show dynamic flow potential
	const nodeArray = Array.from(nodes);
	for (let i = 0; i < nodeArray.length - 1; i++) {
		mmd += `    ${nodeArray[i]} -.->|references| ${nodeArray[i + 1]}\n`;
	}

	masterDoc.transact(() => {
		ytext.insert(0, mmd);
	});
	
	console.log('[collab] Synthesized baseline code-to-diagram architecture');
}
