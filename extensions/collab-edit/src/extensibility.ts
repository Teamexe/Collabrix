/*---------------------------------------------------------------------------------------------
 *  Collaborative Editing Extension for VS Code
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * Plugin interface for extending the collaborative editing system.
 * Implement this interface to add custom functionality to collaboration sessions.
 */
export interface CollabPlugin {
	/** Unique identifier for the plugin */
	readonly id: string;
	/** Human-readable name */
	readonly name: string;

	/** Called when the user joins a room */
	onRoomJoin?(roomId: string, userName: string): void;
	/** Called when the user leaves a room */
	onRoomLeave?(roomId: string): void;
	/** Called when a document edit is applied (local or remote) */
	onEdit?(fileUri: string, content: string): void;
	/** Called on each sync tick */
	onSync?(): void;
	/** Dispose resources */
	dispose?(): void;
}

/**
 * Interface for AI suggestion providers.
 * Implement this to provide AI-powered code suggestions during collaboration.
 */
export interface AIProvider {
	/** Provider name */
	readonly name: string;

	/**
	 * Get AI suggestions for the current cursor context.
	 */
	getSuggestions(
		fileUri: string,
		position: vscode.Position,
		context: string
	): Promise<string[]>;

	/**
	 * Notify the provider about a collaborative edit for learning.
	 */
	onCollaborativeEdit?(
		fileUri: string,
		edit: { offset: number; text: string; isInsert: boolean },
		userName: string
	): void;
}

/**
 * Interface for tracking code execution events.
 */
export interface ExecutionTracker {
	/** Tracker name */
	readonly name: string;

	/** Called when code is executed in the shared terminal */
	onExecution?(command: string, output: string, roomId: string): void;

	/** Called when a debug session starts */
	onDebugStart?(sessionId: string, config: object): void;

	/** Called when a debug session ends */
	onDebugEnd?(sessionId: string): void;
}

/**
 * Extensibility manager — registers and manages plugins.
 */
export class ExtensibilityManager implements vscode.Disposable {
	private readonly _plugins: Map<string, CollabPlugin> = new Map();
	private readonly _aiProviders: Map<string, AIProvider> = new Map();
	private readonly _executionTrackers: Map<string, ExecutionTracker> = new Map();

	/**
	 * Register a collaboration plugin.
	 */
	registerPlugin(plugin: CollabPlugin): vscode.Disposable {
		this._plugins.set(plugin.id, plugin);
		console.log(`[collab] Plugin registered: ${plugin.name}`);

		return {
			dispose: () => {
				plugin.dispose?.();
				this._plugins.delete(plugin.id);
			}
		};
	}

	/**
	 * Register an AI suggestion provider.
	 */
	registerAIProvider(provider: AIProvider): vscode.Disposable {
		this._aiProviders.set(provider.name, provider);
		console.log(`[collab] AI provider registered: ${provider.name}`);

		return {
			dispose: () => {
				this._aiProviders.delete(provider.name);
			}
		};
	}

	/**
	 * Register an execution tracker.
	 */
	registerExecutionTracker(tracker: ExecutionTracker): vscode.Disposable {
		this._executionTrackers.set(tracker.name, tracker);
		console.log(`[collab] Execution tracker registered: ${tracker.name}`);

		return {
			dispose: () => {
				this._executionTrackers.delete(tracker.name);
			}
		};
	}

	/**
	 * Notify all plugins about a room join event.
	 */
	notifyRoomJoin(roomId: string, userName: string): void {
		for (const plugin of this._plugins.values()) {
			plugin.onRoomJoin?.(roomId, userName);
		}
	}

	/**
	 * Notify all plugins about a room leave event.
	 */
	notifyRoomLeave(roomId: string): void {
		for (const plugin of this._plugins.values()) {
			plugin.onRoomLeave?.(roomId);
		}
	}

	/**
	 * Notify all plugins about a document edit.
	 */
	notifyEdit(fileUri: string, content: string): void {
		for (const plugin of this._plugins.values()) {
			plugin.onEdit?.(fileUri, content);
		}
	}

	/**
	 * Get AI suggestions from all registered providers.
	 */
	async getAISuggestions(
		fileUri: string,
		position: vscode.Position,
		context: string
	): Promise<Map<string, string[]>> {
		const results = new Map<string, string[]>();

		for (const [name, provider] of this._aiProviders) {
			try {
				const suggestions = await provider.getSuggestions(fileUri, position, context);
				results.set(name, suggestions);
			} catch (err) {
				console.error(`[collab] AI provider "${name}" error:`, err);
			}
		}

		return results;
	}

	/**
	 * Notify all execution trackers about a command execution.
	 */
	notifyExecution(command: string, output: string, roomId: string): void {
		for (const tracker of this._executionTrackers.values()) {
			tracker.onExecution?.(command, output, roomId);
		}
	}

	dispose(): void {
		for (const plugin of this._plugins.values()) {
			plugin.dispose?.();
		}
		this._plugins.clear();
		this._aiProviders.clear();
		this._executionTrackers.clear();
	}
}
