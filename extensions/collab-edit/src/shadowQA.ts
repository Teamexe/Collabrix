/*---------------------------------------------------------------------------------------------
 *  Collaborative Editing Extension for VS Code
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * Acts as a 3rd phantom pair-programmer in the room.
 * Mocks pushing code deltas to Claude in real-time, receiving programmatic diagnostics 
 * underneath lines of code BEFORE merging.
 */
export class ShadowQA implements vscode.Disposable {
	private readonly _disposables: vscode.Disposable[] = [];
	private _diagnosticCollection: vscode.DiagnosticCollection;
	private _typingTimer: ReturnType<typeof setTimeout> | null = null;

	constructor() {
		this._diagnosticCollection = vscode.languages.createDiagnosticCollection('collabQA');
		
		this._disposables.push(
			this._diagnosticCollection,
			vscode.workspace.onDidChangeTextDocument(this._onTyping, this)
		);
		
		console.log('[collab] Shadow QA Agent active');
	}

	private _onTyping(e: vscode.TextDocumentChangeEvent): void {
		if (e.contentChanges.length === 0 || e.document.uri.scheme !== 'file') return;
		
		if (this._typingTimer) clearTimeout(this._typingTimer);
		
		// Throttle streaming code to external AI backend
		this._typingTimer = setTimeout(() => {
			this._analyzeWithClaude(e.document);
		}, 5000);
	}

	private async _analyzeWithClaude(doc: vscode.TextDocument): Promise<void> {
		const text = doc.getText();
		const config = vscode.workspace.getConfiguration('collab');
		const claudeKey = config.get<string>('claudeApiKey');
		const openAiKey = config.get<string>('openAiApiKey');

		if (!claudeKey && !openAiKey) {
			// Fail gracefully if keys aren't set
			return;
		}

		try {
			let diagnostics: vscode.Diagnostic[] = [];

			if (claudeKey) {
				diagnostics = await this._fetchFromClaude(claudeKey, text);
			} else if (openAiKey) {
				diagnostics = await this._fetchFromOpenAI(openAiKey, text);
			}

			// Reflect AI feedback into local editor UI natively
			this._diagnosticCollection.set(doc.uri, diagnostics);
		} catch (error) {
			console.error('[collab] ShadowQA Error:', error);
		}
	}

	private async _fetchFromClaude(apiKey: string, code: string): Promise<vscode.Diagnostic[]> {
		const response = await fetch('https://api.anthropic.com/v1/messages', {
			method: 'POST',
			headers: {
				'x-api-key': apiKey,
				'anthropic-version': '2023-06-01',
				'content-type': 'application/json'
			},
			body: JSON.stringify({
				model: 'claude-3-opus-20240229',
				max_tokens: 1024,
				messages: [{
					role: 'user',
					content: this._getPrompt(code)
				}]
			})
		});

		if (!response.ok) {
			throw new Error(`Claude API Error: ${response.statusText}`);
		}

		const data = await response.json() as any;
		const rawContent = data.content?.[0]?.text || '';
		return this._parseAiResponse(rawContent);
	}

	private async _fetchFromOpenAI(apiKey: string, code: string): Promise<vscode.Diagnostic[]> {
		const response = await fetch('https://api.openai.com/v1/chat/completions', {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${apiKey}`,
				'content-type': 'application/json'
			},
			body: JSON.stringify({
				model: 'gpt-4o',
				messages: [{
					role: 'user',
					content: this._getPrompt(code)
				}]
			})
		});

		if (!response.ok) {
			throw new Error(`OpenAI API Error: ${response.statusText}`);
		}

		const data = await response.json() as any;
		const rawContent = data.choices?.[0]?.message?.content || '';
		return this._parseAiResponse(rawContent);
	}

	private _getPrompt(code: string): string {
		return `You are a real-time pair programming agent.
Review the following code and return ONLY a JSON array of objects representing anti-patterns, logic bugs, or technical debt.
Do not wrap it in markdown block. Just pure JSON.
Each object must have exactly these keys:
- "line": The 0-indexed line number where the issue occurs. (integer)
- "severity": "error", "warning", or "information".
- "message": A short explanation of the issue.

Code:
${code}`;
	}

	private _parseAiResponse(content: string): vscode.Diagnostic[] {
		const diagnostics: vscode.Diagnostic[] = [];
		try {
			const match = content.match(/\[[\s\S]*\]/);
			if (match) {
				const issues = JSON.parse(match[0]);
				for (const issue of issues) {
					if (typeof issue.line === 'number' && issue.message) {
						const severity = issue.severity === 'error' ? vscode.DiagnosticSeverity.Error 
							: issue.severity === 'warning' ? vscode.DiagnosticSeverity.Warning 
							: vscode.DiagnosticSeverity.Information;
						
						const range = new vscode.Range(issue.line, 0, issue.line, 9999);
						diagnostics.push(new vscode.Diagnostic(range, `🤖 [ShadowQA] ${issue.message}`, severity));
					}
				}
			}
		} catch (e) {
			console.error('Failed to parse AI response:', content);
		}
		return diagnostics;
	}

	dispose(): void {
		if (this._typingTimer) clearTimeout(this._typingTimer);
		for (const d of this._disposables) d.dispose();
	}
}
