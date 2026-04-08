import * as vscode from 'vscode';

/**
 * Custom Collabrix AI Chat Agent mapping securely to OpenAI or Claude.
 * Replaces the need for external Copilot extensions.
 */
export class ChatAgentWebview implements vscode.Disposable {
	private readonly _panel: vscode.WebviewPanel;
	private readonly _disposables: vscode.Disposable[] = [];

	constructor(
		private readonly _claudeKey: string | undefined, 
		private readonly _openAiKey: string | undefined,
		onDisposeCallback: () => void
	) {
		this._panel = vscode.window.createWebviewPanel(
			'collabChatAgent',
			'Collabrix AI Agent',
			vscode.ViewColumn.Two,
			{ enableScripts: true, retainContextWhenHidden: true }
		);

		this._panel.webview.onDidReceiveMessage(async (message) => {
			if (message.command === 'chat') {
				if (!this._claudeKey && !this._openAiKey) {
					this._pushMessage('error', 'Please configure your Claude or OpenAI API key in VS Code Settings.');
					return;
				}

				this._pushMessage('system', 'Thinking...');
				
				try {
					const activeEditor = vscode.window.activeTextEditor;
					const activeCode = activeEditor ? `\n\nActive File (${vscode.workspace.asRelativePath(activeEditor.document.uri)}):\n\n${activeEditor.document.getText()}` : '';

					const prompt = `${message.text}\n${activeCode}`;
					const reply = await this._fetchAI(prompt);
					
					this._pushMessage('ai', reply);
				} catch (err: any) {
					this._pushMessage('error', `AIAgent Error: ${err.message}`);
				}
			}
		}, null, this._disposables);

		this._panel.onDidDispose(() => {
			this.dispose();
			onDisposeCallback();
		}, null, this._disposables);

		this._panel.webview.html = this._getHtmlForWebview();
	}

	public reveal(): void {
		this._panel.reveal();
	}

	private _pushMessage(role: string, text: string): void {
		this._panel.webview.postMessage({ command: 'message', role, text });
	}

	private async _fetchAI(prompt: string): Promise<string> {
		if (this._claudeKey) {
			const res = await fetch('https://api.anthropic.com/v1/messages', {
				method: 'POST',
				headers: {
					'x-api-key': this._claudeKey,
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
			return data.content?.[0]?.text || '';
		} else if (this._openAiKey) {
			const res = await fetch('https://api.openai.com/v1/chat/completions', {
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${this._openAiKey}`,
					'content-type': 'application/json'
				},
				body: JSON.stringify({
					model: 'gpt-4o',
					messages: [{ role: 'user', content: prompt }]
				})
			});
			if (!res.ok) throw new Error(res.statusText);
			const data = await res.json() as any;
			return data.choices?.[0]?.message?.content || '';
		}
		throw new Error("Missing keys");
	}

	private _getHtmlForWebview(): string {
		return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { font-family: var(--vscode-font-family); padding: 10px; display: flex; flex-direction: column; height: 100vh; box-sizing: border-box; }
        #chat { flex: 1; overflow-y: auto; margin-bottom: 10px; }
        .msg { margin-bottom: 10px; padding: 8px; border-radius: 4px; }
        .user { background: var(--vscode-button-background); color: var(--vscode-button-foreground); align-self: flex-end; }
        .ai { background: var(--vscode-editorHoverWidget-background); border: 1px solid var(--vscode-editorHoverWidget-border); }
        .system { color: var(--vscode-descriptionForeground); font-style: italic; font-size: 0.9em; }
        .error { color: var(--vscode-errorForeground); }
        .input-box { display: flex; }
        input { flex: 1; padding: 8px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); }
        button { padding: 8px 12px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; cursor: pointer; }
		pre { white-space: pre-wrap; font-family: monospace; background: #000; padding: 8px; }
    </style>
</head>
<body>
    <h3>Collabrix Custom AI Sync</h3>
    <div id="chat">
        <div class="msg system">Welcome! Ask me anything. I automatically read your active workspace context.</div>
    </div>
    <div class="input-box">
        <input type="text" id="prompt" placeholder="Ask AI..." autofocus />
        <button id="send">Send</button>
    </div>
    <script>
        const vscode = acquireVsCodeApi();
        const chat = document.getElementById('chat');
        const input = document.getElementById('prompt');
        const btn = document.getElementById('send');

        function addMsg(role, text) {
			// Extremely naive render
			const div = document.createElement('div');
			div.className = 'msg ' + role;
			if(role === 'ai') {
				div.innerText = '🤖 ' + text;
			} else {
				div.innerText = text;
			}
			chat.appendChild(div);
			chat.scrollTop = chat.scrollHeight;
        }

        btn.addEventListener('click', () => {
            if(!input.value) return;
            addMsg('user', input.value);
            vscode.postMessage({ command: 'chat', text: input.value });
            input.value = '';
        });

        input.addEventListener('keypress', (e) => {
            if(e.key === 'Enter') btn.click();
        });

        window.addEventListener('message', e => {
            if(e.data.command === 'message') {
                // If it's system 'Thinking...', remove the old thinking message
                const prev = chat.lastElementChild;
                if(e.data.role !== 'system' && prev && prev.innerText.includes('Thinking...')) {
                    chat.removeChild(prev);
                }
                addMsg(e.data.role, e.data.text);
            }
        });
    </script>
</body>
</html>`;
	}

	dispose(): void {
		this._panel.dispose();
		for (const d of this._disposables) d.dispose();
	}
}
