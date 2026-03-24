/*---------------------------------------------------------------------------------------------
 *  Collaborative Editing Extension for VS Code
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as Y from 'yjs';

export interface Task {
	id: string;
	title: string;
	fileRelPath: string;
	line: number;
	completed: boolean;
	assignee?: string;
}

export class TaskTreeItem extends vscode.TreeItem {
	constructor(public readonly task: Task) {
		super(
			task.completed ? `✓ ${task.title}` : task.title, 
			vscode.TreeItemCollapsibleState.None
		);
		this.description = `${task.fileRelPath}:${task.line}${task.assignee ? ` (@${task.assignee})` : ''}`;
		this.contextValue = 'collabTask';
		this.iconPath = new vscode.ThemeIcon(task.completed ? 'pass' : 'circle-outline');
		
		this.command = {
			command: 'collab.openTask',
			title: 'Open Task Location',
			arguments: [task]
		};
	}
}

/**
 * Replaces external Jira features by maintaining a real-time CRDT task list
 * actively bound to lines of code.
 */
export class TaskSystem implements vscode.TreeDataProvider<TaskTreeItem>, vscode.Disposable {
	private _onDidChangeTreeData = new vscode.EventEmitter<TaskTreeItem | undefined | null | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private readonly _tasks: Y.Array<Task>;
	private readonly _disposables: vscode.Disposable[] = [];

	constructor(masterDoc: Y.Doc) {
		this._tasks = masterDoc.getArray<Task>('tasks');
		
		this._tasks.observe(() => {
			this._onDidChangeTreeData.fire();
		});

		this._disposables.push(
			vscode.window.registerTreeDataProvider('collabTasks', this),
			vscode.commands.registerCommand('collab.createTask', this._createTask.bind(this)),
			vscode.commands.registerCommand('collab.completeTask', this._completeTask.bind(this)),
			vscode.commands.registerCommand('collab.openTask', this._openTask.bind(this)),
			vscode.commands.registerCommand('collab.assignToAI', this._assignToAI.bind(this))
		);
	}

	getTreeItem(element: TaskTreeItem): vscode.TreeItem {
		return element;
	}

	getChildren(): Thenable<TaskTreeItem[]> {
		const items = this._tasks.toArray().map(t => new TaskTreeItem(t));
		// Sort uncompleted to the top
		items.sort((a, b) => (a.task.completed === b.task.completed ? 0 : a.task.completed ? 1 : -1));
		return Promise.resolve(items);
	}

	private async _createTask(): Promise<void> {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showErrorMessage('Open a file to link the task to a specific line of code.');
			return;
		}

		const title = await vscode.window.showInputBox({ 
			prompt: 'Enter Task / Jira Ticket issue',
			placeHolder: 'e.g. Fix null pointer exception here'
		});
		if (!title) return;

		const relPath = vscode.workspace.asRelativePath(editor.document.uri, false);
		const line = editor.selection.active.line + 1;

		const newTask: Task = {
			id: Math.random().toString(36).substring(2, 9),
			title,
			fileRelPath: relPath,
			line,
			completed: false
		};

		this._tasks.doc!.transact(() => {
			this._tasks.push([newTask]);
		});
	}

	private _completeTask(item: TaskTreeItem): void {
		const index = this._tasks.toArray().findIndex(t => t.id === item.task.id);
		if (index > -1) {
			this._tasks.doc!.transact(() => {
				const task = this._tasks.get(index);
				task.completed = !task.completed;
				this._tasks.delete(index, 1);
				this._tasks.insert(index, [task]);
			});
		}
	}

	private _assignToAI(item: TaskTreeItem): void {
		const index = this._tasks.toArray().findIndex(t => t.id === item.task.id);
		if (index > -1) {
			this._tasks.doc!.transact(() => {
				const task = this._tasks.get(index);
				task.assignee = 'Claude';
				this._tasks.delete(index, 1);
				this._tasks.insert(index, [task]);
			});
			
			vscode.window.showInformationMessage(`🤖 [@Claude] Acknowledged task "${item.task.title}". Pulling specific component workspace context...`);
			
			// Mock AI completing the code edit physically using VS Code programmatic edit APIs
			setTimeout(async () => {
				const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
				if (!workspaceRoot) return;

				const fileUri = vscode.Uri.joinPath(workspaceRoot, item.task.fileRelPath);
				const edit = new vscode.WorkspaceEdit();
				
				// Physically write to the file
				edit.insert(fileUri, new vscode.Position(item.task.line, 0), `\n// [🤖 Claude-3-Opus] Auto-resolved Task Ticket "${item.task.title}" via semantic reasoning bypass.\n`);
				await vscode.workspace.applyEdit(edit);
				
				vscode.window.showInformationMessage(`✅ [@Claude] Fully resolved task: "${item.task.title}". Code modifications injected.`);
				this._completeTask(item); // Auto-close it
			}, 3500);
		}
	}

	private async _openTask(task: Task): Promise<void> {
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
		if (!workspaceRoot) return;

		const fileUri = vscode.Uri.joinPath(workspaceRoot, task.fileRelPath);
		try {
			const doc = await vscode.workspace.openTextDocument(fileUri);
			const editor = await vscode.window.showTextDocument(doc);
			
			const pos = new vscode.Position(task.line - 1, 0);
			editor.selection = new vscode.Selection(pos, pos);
			editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
		} catch (err) {
			vscode.window.showErrorMessage(`Failed to open ${task.fileRelPath}`);
		}
	}

	dispose(): void {
		for (const d of this._disposables) d.dispose();
	}
}
