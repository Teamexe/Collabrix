/*---------------------------------------------------------------------------------------------
 *  Collabrix — Intent Prefetcher
 *  Predicts likely next dependencies from open files and pre-installs them.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/** Known import patterns → package name */
const IMPORT_PATTERNS: Array<{ regex: RegExp; pkg: string }> = [
	{ regex: /from ['"]react['"]/, pkg: 'react' },
	{ regex: /from ['"]react-dom['"]/, pkg: 'react-dom' },
	{ regex: /from ['"]axios['"]/, pkg: 'axios' },
	{ regex: /from ['"]lodash['"]/, pkg: 'lodash' },
	{ regex: /from ['"]express['"]/, pkg: 'express' },
	{ regex: /from ['"]zod['"]/, pkg: 'zod' },
	{ regex: /from ['"]@tanstack/, pkg: '@tanstack/react-query' },
	{ regex: /from ['"]prisma['"]/, pkg: '@prisma/client' },
	{ regex: /from ['"]socket\.io['"]/, pkg: 'socket.io' },
	{ regex: /import\s+\w+\s+from\s+['"]uuid['"]/, pkg: 'uuid' },
];

export class IntentPrefetcher implements vscode.Disposable {
	private readonly _disposables: vscode.Disposable[] = [];
	private readonly _statusBar: vscode.StatusBarItem;
	private _prefetchTimer: ReturnType<typeof setTimeout> | null = null;
	private readonly _prefetched = new Set<string>();

	constructor() {
		this._statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 90);
		this._statusBar.command = 'collab.prefetchDeps';
		this._statusBar.tooltip = 'Collabrix: Click to manually trigger dependency prefetch';

		this._disposables.push(
			this._statusBar,
			vscode.workspace.onDidOpenTextDocument(doc => this._schedule(doc)),
			vscode.workspace.onDidChangeTextDocument(e => this._schedule(e.document)),
		);

		// Run once on activation for already-open editors
		for (const editor of vscode.window.visibleTextEditors) {
			this._schedule(editor.document);
		}
	}

	/** Trigger a manual prefetch run */
	async runManual(): Promise<void> {
		const docs = vscode.workspace.textDocuments;
		const pkgs = new Set<string>();
		for (const doc of docs) {
			this._detectPackages(doc).forEach(p => pkgs.add(p));
		}
		await this._install([...pkgs]);
	}

	private _schedule(doc: vscode.TextDocument): void {
		if (doc.uri.scheme !== 'file') return;
		if (this._prefetchTimer) clearTimeout(this._prefetchTimer);
		this._prefetchTimer = setTimeout(() => this._run(doc), 3000);
	}

	private async _run(doc: vscode.TextDocument): Promise<void> {
		const pkgs = this._detectPackages(doc).filter(p => !this._prefetched.has(p));
		if (pkgs.length === 0) return;
		await this._install(pkgs);
	}

	private _detectPackages(doc: vscode.TextDocument): string[] {
		const text = doc.getText();
		const found: string[] = [];
		for (const { regex, pkg } of IMPORT_PATTERNS) {
			if (regex.test(text)) found.push(pkg);
		}
		return found;
	}

	private async _install(pkgs: string[]): Promise<void> {
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (!workspaceRoot) return;

		// Only install if package.json exists
		try {
			await vscode.workspace.fs.stat(
				vscode.Uri.file(path.join(workspaceRoot, 'package.json'))
			);
		} catch {
			return; // Not a Node project
		}

		this._statusBar.text = `$(sync~spin) Prefetching: ${pkgs.join(', ')}`;
		this._statusBar.show();

		try {
			await execAsync(`npm install --prefer-offline ${pkgs.join(' ')}`, {
				cwd: workspaceRoot,
				timeout: 60000
			});
			pkgs.forEach(p => this._prefetched.add(p));
			this._statusBar.text = `$(check) Prefetched: ${pkgs.join(', ')}`;
			console.log(`[prefetcher] Installed: ${pkgs.join(', ')}`);
			setTimeout(() => this._statusBar.hide(), 4000);
		} catch (err) {
			this._statusBar.text = `$(warning) Prefetch failed`;
			setTimeout(() => this._statusBar.hide(), 3000);
			console.warn('[prefetcher] Install failed:', err);
		}
	}

	dispose(): void {
		if (this._prefetchTimer) clearTimeout(this._prefetchTimer);
		for (const d of this._disposables) d.dispose();
	}
}
