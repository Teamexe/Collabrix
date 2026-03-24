/*---------------------------------------------------------------------------------------------
 *  Collaborative Editing Extension for VS Code
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Manages the lifecycle of an isolated Docker container for the collaborative room.
 * This runs solely on the host's machine. Remote terminals tunnel into this container.
 */
export class DockerManager {
	private _containerId: string | null = null;
	
	/**
	 * Spin up a detached Ubuntu container mapped to the host's active workspace.
	 */
	async spinUpEnvironment(workspacePath: string): Promise<string> {
		try {
			// Pulls latest ubuntu, mounts the VS Code workspace, and keeps it alive in background
			const cmd = `docker run -d --rm -v "${workspacePath}:/workspace" -w /workspace ubuntu:latest tail -f /dev/null`;
			const { stdout } = await execAsync(cmd);
			
			this._containerId = stdout.trim();
			console.log(`[collab] Spun up Docker Environment: ${this._containerId}`);
			
			vscode.window.showInformationMessage('🚀 Secure Docker Dev Environment Initialized.');
			return this._containerId;
		} catch (err) {
			console.error(`[collab] Docker spin-up failed:`, err);
			vscode.window.showErrorMessage('Failed to spin up Docker environment. Is Docker installed and running?');
			throw err;
		}
	}

	get containerId(): string | null {
		return this._containerId;
	}

	/**
	 * Nuke the container when the room hosting ends.
	 */
	async destroyEnvironment(): Promise<void> {
		if (this._containerId) {
			try {
				await execAsync(`docker rm -f ${this._containerId}`);
				console.log(`[collab] Destroyed Docker Environment: ${this._containerId}`);
			} catch (err) {
				console.error(`[collab] Failed to destroy container ${this._containerId}`, err);
			}
			this._containerId = null;
		}
	}
}
