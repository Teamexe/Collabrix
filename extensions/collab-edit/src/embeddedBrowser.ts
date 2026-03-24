/*---------------------------------------------------------------------------------------------
 *  Collaborative Editing Extension for VS Code
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as Y from 'yjs';

/**
 * Creates an embedded browser view inside the IDE linked directly to a CRDT.
 * If one user navigates to a new web page, everyone's browser follows immediately.
 */
export class EmbeddedBrowser implements vscode.Disposable {
	private _panel: vscode.WebviewPanel | null = null;
	private readonly _disposables: vscode.Disposable[] = [];
	private readonly _browserUrl: Y.Text;

	// Anti-infinite loop reflection shield
	private _isApplyingRemote = false;

	constructor(masterDoc: Y.Doc) {
		this._browserUrl = masterDoc.getText('browserUrl');

		this._disposables.push(
			vscode.commands.registerCommand('collab.openBrowser', this._open.bind(this))
		);

		this._browserUrl.observe(this._onRemoteChange.bind(this));
	}

	private _open(): void {
		if (this._panel) {
			this._panel.reveal();
			return;
		}

		this._panel = vscode.window.createWebviewPanel(
			'collabBrowser',
			'Team Browser',
			vscode.ViewColumn.Beside,
			{ enableScripts: true, enableForms: true, retainContextWhenHidden: true }
		);

		this._panel.webview.onDidReceiveMessage((msg) => {
			if (msg.command === 'navigate') {
				if (this._isApplyingRemote) return;
				
				let safeUrl = msg.url;
				if (!safeUrl.startsWith('http')) safeUrl = 'https://' + safeUrl;

				this._browserUrl.doc!.transact(() => {
					this._browserUrl.delete(0, this._browserUrl.length);
					this._browserUrl.insert(0, safeUrl);
				});
			}
		}, null, this._disposables);

		this._panel.onDidDispose(() => {
			this._panel = null;
		}, null, this._disposables);

		// Init empty or existing CRDT
		if (this._browserUrl.length === 0) {
			this._browserUrl.doc!.transact(() => {
				this._browserUrl.insert(0, 'https://example.com');
			});
		} else {
			this._render(this._browserUrl.toString());
		}
	}

	private _onRemoteChange(): void {
		if (!this._panel) return;
		this._isApplyingRemote = true;
		this._render(this._browserUrl.toString());
		setTimeout(() => this._isApplyingRemote = false, 150);
	}

	private _render(url: string): void {
		if (!this._panel) return;
		this._panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
	<style>
		:root {
			--focus-border: #007fd4;
		}
		body {
			margin:0; padding:0; overflow:hidden; display:flex; 
			flex-direction:column; height:100vh; background: var(--vscode-editor-background);
		}
		.nav {
			padding:6px 12px; background:var(--vscode-editor-inactiveSelectionBackground); 
			display:flex; gap:10px; align-items:center; border-bottom: 1px solid var(--vscode-widget-border);
		}
		input {
			flex:1; background:var(--vscode-input-background); color:var(--vscode-input-foreground); 
			border:1px solid var(--vscode-input-border); padding:6px; outline:none; font-family:var(--vscode-font-family);
		}
		input:focus { border-color: var(--focus-border); }
		button {
			background:var(--vscode-button-background); color:var(--vscode-button-foreground); 
			border:none; cursor:pointer; padding:6px 14px; font-weight:bold;
		}
		button:hover { background:var(--vscode-button-hoverBackground); }
		iframe {
			flex:1; border:none; width:100%; background:white;
		}
	</style>
</head>
<body>
	<div class="nav">
		<input id="url" type="text" value="${url}" placeholder="Enter URL to navigate cluster..." />
		<button id="go">Navigate</button>
	</div>
	<iframe src="${url}"></iframe>
	<script>
		const vscode = acquireVsCodeApi();
		document.getElementById('go').onclick = () => {
			vscode.postMessage({ command: 'navigate', url: document.getElementById('url').value });
		};
        document.getElementById('url').addEventListener('keypress', function (e) {
            if (e.key === 'Enter') {
                vscode.postMessage({ command: 'navigate', url: document.getElementById('url').value });
            }
        });
	</script>
</body>
</html>`;
	}

	dispose(): void {
		this._browserUrl.unobserve(this._onRemoteChange.bind(this));
		this._panel?.dispose();
		for (const d of this._disposables) d.dispose();
	}
}
