/*---------------------------------------------------------------------------------------------
 *  Collaborative Editing Extension for VS Code
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { Awareness } from 'y-protocols/awareness';

export interface WsProviderOptions {
	serverUrl: string;
	roomName: string;
	doc: Y.Doc;
}

/**
 * Wraps y-websocket's WebsocketProvider, connecting a Y.Doc to a
 * collaboration room via WebSocket.
 *
 * Exposes the Awareness instance for cursor/presence sharing.
 */
export class WsProvider {
	private _provider: WebsocketProvider | null = null;
	private readonly _serverUrl: string;
	private readonly _roomName: string;
	private readonly _doc: Y.Doc;

	private _onStatusChange: ((status: { status: string }) => void) | null = null;

	constructor(options: WsProviderOptions) {
		this._serverUrl = options.serverUrl;
		this._roomName = options.roomName;
		this._doc = options.doc;
	}

	/**
	 * Connect to the y-websocket server.
	 */
	connect(): void {
		if (this._provider) {
			return;
		}

		this._provider = new WebsocketProvider(
			this._serverUrl,
			this._roomName,
			this._doc,
			{ connect: true }
		);

		this._provider.on('status', (event: { status: string }) => {
			console.log(`[collab] WebSocket status: ${event.status}`);
			if (this._onStatusChange) {
				this._onStatusChange(event);
			}
		});

		console.log(`[collab] Connected to room "${this._roomName}" at ${this._serverUrl}`);
	}

	/**
	 * Disconnect from the server.
	 */
	disconnect(): void {
		if (this._provider) {
			this._provider.destroy();
			this._provider = null;
			console.log(`[collab] Disconnected from room "${this._roomName}"`);
		}
	}

	/**
	 * Get the Awareness instance for presence/cursor sharing.
	 */
	get awareness(): Awareness | null {
		return this._provider?.awareness ?? null;
	}

	/**
	 * Whether the provider is currently connected.
	 */
	get isConnected(): boolean {
		return this._provider?.wsconnected ?? false;
	}

	/**
	 * Register a callback for connection status changes.
	 */
	onStatusChange(callback: (status: { status: string }) => void): void {
		this._onStatusChange = callback;
	}

	/**
	 * Get the room name.
	 */
	get roomName(): string {
		return this._roomName;
	}

	dispose(): void {
		this.disconnect();
	}
}
