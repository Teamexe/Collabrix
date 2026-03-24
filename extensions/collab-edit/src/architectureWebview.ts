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

		// Handle Developer UI input -> Y.Text
		this._panel.webview.onDidReceiveMessage((message) => {
			if (message.command === 'updateDiagram') {
				if (this._isApplyingRemote) return;
				
				masterDoc.transact(() => {
					this._ytext.delete(0, this._ytext.length);
					this._ytext.insert(0, message.text);
				});
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
	}

	public reveal(): void {
		this._panel.reveal();
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
    </style>
</head>
<body>
	<div class="header">
		<span class="branding">Collabrix: Live Visual Architecture</span>
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
