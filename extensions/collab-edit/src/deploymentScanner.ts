import * as vscode from 'vscode';
import * as path from 'path';

export class DeploymentScanner {
	private readonly _highRiskFiles = ['package.json', 'Dockerfile', 'docker-compose.yml', 'server.js', 'server.ts', 'app.py', 'app.js', 'nginx.conf', '.env.example'];

	constructor(private _claudeKey: string | undefined, private _openAiKey: string | undefined) {}

	public async runScan(): Promise<void> {
		if (!this._claudeKey && !this._openAiKey) {
			vscode.window.showErrorMessage('You must set a Claude or OpenAI API key in settings to run the Deployment Scanner.');
			return;
		}

		const mode = await vscode.window.showQuickPick(
			[
				{ label: '🚀 Quick Scan (High-Risk Files Only)', description: 'Saves tokens. Audits package.json, Dockerfile, etc.' },
				{ label: '🔥 Deep Audit (Full Project Sync)', description: 'Passes the entire file content. Expensive!' }
			],
			{ placeHolder: 'Select Deployment Audit Depth' }
		);

		if (!mode) return; // User cancelled

		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: 'AIAuditor: Syncing Project for Deployment Scan...',
			cancellable: false
		}, async (progress) => {
			const workspaceRoot = vscode.workspace.workspaceFolders?.[0];
			if (!workspaceRoot) {
				vscode.window.showErrorMessage('No workspace folder open.');
				return;
			}

			// Gather context
			progress.report({ message: 'Gathering file structure...' });
			const files = await vscode.workspace.findFiles('**/*', '**/node_modules/**');
			const tree = files.map(f => vscode.workspace.asRelativePath(f)).join('\n');
			
			let combinedContent = `PROJECT TREE:\n${tree}\n\n`;

			const isDeep = mode.label.includes('Deep Audit');
			
			for (const file of files) {
				const ext = path.extname(file.fsPath);
				// Ignore binaries and large generic folders
				if (['.png', '.jpg', '.vsix', '.zip', '.exe'].includes(ext)) continue;

				const relativeName = path.basename(file.fsPath);
				
				if (isDeep || this._highRiskFiles.includes(relativeName) || relativeName.includes('config')) {
					progress.report({ message: `Reading ${relativeName}...` });
					try {
						const doc = await vscode.workspace.openTextDocument(file);
						// Hard cap limits per file so we don't blow up context 100%
						const txt = doc.getText().substring(0, 5000); 
						combinedContent += `\n--- FILE: ${vscode.workspace.asRelativePath(file)} ---\n${txt}\n`;
					} catch (e) {
						// skip binary or unreadable
					}
				}
			}

			progress.report({ message: 'Analyzing with AI Model...' });
			try {
				const report = await this._fetchAI(combinedContent);
				
				const reportUri = vscode.Uri.joinPath(workspaceRoot.uri, 'DEPLOY_AUDIT_REPORT.md');
				const edit = new vscode.WorkspaceEdit();
				
				// Safely create or overwrite
				try { await vscode.workspace.fs.stat(reportUri); } 
				catch { edit.createFile(reportUri, { ignoreIfExists: true }); }

				edit.replace(reportUri, new vscode.Range(0,0,9999,9999), report);
				await vscode.workspace.applyEdit(edit);
				
				// Open the report
				const doc = await vscode.workspace.openTextDocument(reportUri);
				await vscode.window.showTextDocument(doc);
				
				vscode.window.showInformationMessage('🎉 Deployment Scan Complete!');

			} catch (err: any) {
				vscode.window.showErrorMessage(`Audit Failed: ${err.message}`);
			}
		});
	}

	private async _fetchAI(contextPayload: string): Promise<string> {
		const prompt = `You are an elite Lead DevOps Engineer and Security Auditor. 
Analyze the following project structure and deployment files. 
Point out any potential deployment bugs, missing configs, vulnerabilities, or misalignments.
Write your response in beautiful Markdown format.

CONTEXT:
${contextPayload}`;

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
					max_tokens: 4096,
					messages: [{ role: 'user', content: prompt }]
				})
			});
			if (!res.ok) throw new Error(`Claude Error: ${res.statusText}`);
			const data = await res.json() as any;
			return data.content?.[0]?.text || 'No response';
		} else if (this._openAiKey) {
			const res = await fetch('https://api.openai.com/v1/chat/completions', {
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${this._openAiKey}`,
					'content-type': 'application/json'
				},
				body: JSON.stringify({
					model: 'gpt-4o', // or gpt-4-turbo
					messages: [{ role: 'user', content: prompt }]
				})
			});
			if (!res.ok) throw new Error(`OpenAI Error: ${res.statusText}`);
			const data = await res.json() as any;
			return data.choices?.[0]?.message?.content || 'No response';
		}
		throw new Error("No API key configured");
	}
}
