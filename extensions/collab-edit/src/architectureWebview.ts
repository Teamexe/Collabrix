/*---------------------------------------------------------------------------------------------
 *  Collaborative Editing Extension for VS Code
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as Y from 'yjs';

/**
 * Provides a live-updating Mermaid.js Webview panel that synchronizes
 * an architecture diagram across all room participants using a dedicated Y.Text CRDT.
 */
export class ArchitectureWebview implements vscode.Disposable {
	private readonly _panel: vscode.WebviewPanel;
	private readonly _disposables: vscode.Disposable[] = [];
	private readonly _ytext: Y.Text;
	private _autoSyncTimeout: NodeJS.Timeout | number | null = null;

	// Guard against infinite loop reflections
	private _isApplyingRemote = false;

	constructor(masterDoc: Y.Doc, onDisposeCallback: () => void) {
		this._ytext = masterDoc.getText('architecture');

		this._panel = vscode.window.createWebviewPanel(
			'collabArchitecture',
			'Team Brain: Architecture',
			vscode.ViewColumn.Two,
			{
				enableScripts: true,
				retainContextWhenHidden: true
			}
		);

		// Handle Developer UI input -> Y.Text and Commands
		this._panel.webview.onDidReceiveMessage(async (message) => {
			if (message.command === 'updateDiagram') {
				if (this._isApplyingRemote) return;
				
				masterDoc.transact(() => {
					this._ytext.delete(0, this._ytext.length);
					this._ytext.insert(0, message.text);
				});
			} else if (message.command === 'autoGenerate') {
				await this._handleAutoGenerate(masterDoc);
			}
		}, null, this._disposables);

		// Handle Remote User modifications -> Webview Refresh
		this._ytext.observe(this._onRemoteChange);

		this._panel.onDidDispose(() => {
			this.dispose();
			onDisposeCallback();
		}, null, this._disposables);

		this._panel.webview.html = this._getHtmlForWebview();

		// Initial render if room already has a diagram
		if (this._ytext.length > 0) {
			setTimeout(() => {
				this._pushToWebview(this._ytext.toString());
			}, 500);
		}

		// Real-time Code Change Sync!
		vscode.workspace.onDidSaveTextDocument(async (doc) => {
			if (doc.fileName.includes('node_modules') || doc.fileName.includes('.git')) return;
			
			if (this._autoSyncTimeout) clearTimeout(this._autoSyncTimeout as any);
			
			// Wait 3 seconds after save to avoid spamming the LLM API
			this._autoSyncTimeout = setTimeout(async () => {
				await this._handleAutoGenerate(masterDoc, true, doc);
			}, 3000) as any;
		}, null, this._disposables);
	}

	public reveal(): void {
		this._panel.reveal();
	}

	private async _handleAutoGenerate(masterDoc: Y.Doc, isSilent: boolean = false, changedDoc?: vscode.TextDocument): Promise<void> {
		const config = vscode.workspace.getConfiguration('collab');
		const claudeKey = config.get<string>('claudeApiKey');
		const openAiKey = config.get<string>('openAiApiKey');

		if (!claudeKey && !openAiKey) {
			if (!isSilent) vscode.window.showErrorMessage('Configure Claude or OpenAI API key to Auto-Generate Graphs.');
			return;
		}

		const generatorTask = async (progress?: vscode.Progress<{ message?: string }>) => {
			try {
				if (progress) progress.report({ message: 'Reading workspace files...' });
				const files = await vscode.workspace.findFiles('**/*', '**/node_modules/**');
				const tree = files.slice(0, 50).map(f => vscode.workspace.asRelativePath(f)).join('\n');
				const currentGraph = this._ytext.toString() || 'graph TD;';
				
				let prompt = `You are a software architect maintaining this project's architecture diagram.
Only output valid Mermaid code starting with "graph TD;". No markdown ticks or explanation.

Current Diagram:
${currentGraph}

Project Files:
${tree}

Task: Output a refreshed Mermaid diagram. You MUST keep the layout style, syntax, and overall structure as consistent as possible with the "Current Diagram" to prevent massive visual jumping. Only add/remove nodes and links as necessary.`;

				if (changedDoc) {
					// Supply actual code context so the LLM tracks architectural shifts in real time!
					const recentCode = changedDoc.getText().substring(0, 2000);
					prompt += `\n\nAdditionally, the developer just updated the file: ${vscode.workspace.asRelativePath(changedDoc.uri)}.\nHere is the new code. Update the diagram to reflect this new code, while strongly maintaining the previous visual aesthetic:\n\n${recentCode}`;
				}

				let mermaidCode = '';

				if (claudeKey) {
					const res = await fetch('https://api.anthropic.com/v1/messages', {
						method: 'POST',
						headers: {
							'x-api-key': claudeKey,
							'anthropic-version': '2023-06-01',
							'content-type': 'application/json'
						},
						body: JSON.stringify({
							model: 'claude-3-opus-20240229',
							max_tokens: 1024,
							messages: [{ role: 'user', content: prompt }]
						})
					});
					if (!res.ok) throw new Error(res.statusText);
					const data = await res.json() as any;
					mermaidCode = data.content?.[0]?.text || '';
				} else if (openAiKey) {
					const res = await fetch('https://api.openai.com/v1/chat/completions', {
						method: 'POST',
						headers: {
							'Authorization': `Bearer ${openAiKey}`,
							'content-type': 'application/json'
						},
						body: JSON.stringify({
							model: 'gpt-4o',
							messages: [{ role: 'user', content: prompt }]
						})
					});
					if (!res.ok) throw new Error(res.statusText);
					const data = await res.json() as any;
					mermaidCode = data.choices?.[0]?.message?.content || '';
				}

				// Clean up markdown block if present
				mermaidCode = mermaidCode.replace(/\`\`\`mermaid/i, '').replace(/\`\`\`/g, '').trim();

				masterDoc.transact(() => {
					this._ytext.delete(0, this._ytext.length);
					this._ytext.insert(0, mermaidCode);
				});
			} catch (err: any) {
				if (!isSilent) vscode.window.showErrorMessage(`Auto-Gen Failed: ${err.message}`);
			}
		};

		if (isSilent) {
			// Subtly show progress in the status bar instead of a blocking popup
			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Window,
				title: 'Collabrix: Real-time architecture updating...'
			}, generatorTask);
		} else {
			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: 'Collabrix: AI generating architecture diagram...',
				cancellable: false
			}, generatorTask);
		}
	}

	private readonly _onRemoteChange = (): void => {
		this._isApplyingRemote = true;
		this._pushToWebview(this._ytext.toString());
		
		setTimeout(() => {
			this._isApplyingRemote = false;
		}, 100);
	};

	private _pushToWebview(text: string): void {
		this._panel.webview.postMessage({ command: 'render', text });
	}

	private _getHtmlForWebview(): string {
		return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Architecture</title>
    <!-- Include Mermaid from CDN -->
    <script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
    <style>
        body { 
			margin: 0; padding: 10px; color: var(--vscode-editor-foreground); 
			background: var(--vscode-editor-background); font-family: var(--vscode-font-family); 
			display: flex; flex-direction: column; height: 100vh; overflow: hidden;
		}
        #diagram-container { 
			flex: 1; overflow: auto; display: flex; align-items: center; justify-content: center; 
			background: var(--vscode-editor-inactiveSelectionBackground); border-radius: 4px; margin-bottom: 10px; 
		}
        textarea { 
			height: 150px; width: 100%; background: var(--vscode-input-background); 
			color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); 
			font-family: monospace; padding: 10px; box-sizing: border-box; resize: vertical; 
		}
		.header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
		.branding { font-weight: bold; background: linear-gradient(90deg, #ff007f, #00d2ff); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-size: 1.2em; }
		#autoGenBtn { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 10px; cursor: pointer; border-radius: 2px; }
    </style>
</head>
<body>
	<div class="header">
		<span class="branding">Collabrix: Live Visual Architecture</span>
		<button id="autoGenBtn">Auto-Generate from Files</button>
	</div>
    <div id="diagram-container">
        <div class="mermaid" id="mermaid-target"></div>
    </div>
    <textarea id="editor" placeholder="Type Mermaid syntax here (e.g. graph TD; App-->DB;)"></textarea>

    <script>
        mermaid.initialize({ startOnLoad: false, theme: 'dark' });
        
        const vscode = acquireVsCodeApi();
        const editor = document.getElementById('editor');
        const target = document.getElementById('mermaid-target');
		const autoGenBtn = document.getElementById('autoGenBtn');

		autoGenBtn.addEventListener('click', () => {
			vscode.postMessage({ command: 'autoGenerate' });
		});

		let isRendering = false;

        async function renderDiagram(code) {
			if (isRendering || !code.trim()) return;
			isRendering = true;
            try {
				target.removeAttribute('data-processed');
				target.innerHTML = code;
                await mermaid.run({ nodes: [target] });
            } catch (e) {
                // Ignore parse errors while typing (Mermaid is notoriously strict)
            } finally {
				isRendering = false;
			}
        }

        // Editor typing event -> Pass to Extension Host
        editor.addEventListener('input', () => {
			const text = editor.value;
            vscode.postMessage({ command: 'updateDiagram', text });
            renderDiagram(text);
        });

        // Remote user event -> Update local DOM
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'render') {
				if (editor.value !== message.text) {
                	editor.value = message.text;
				}
                renderDiagram(message.text);
            }
        });
    </script>
</body>
</html>`;
	}

	dispose(): void {
		this._ytext.unobserve(this._onRemoteChange);
		this._panel.dispose();
		for (const d of this._disposables) d.dispose();
	}
}
