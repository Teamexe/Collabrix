/**
 * Type declarations for y-websocket
 */
declare module 'y-websocket' {
	import * as Y from 'yjs';
	import { Awareness } from 'y-protocols/awareness';

	export class WebsocketProvider {
		constructor(
			serverUrl: string,
			roomname: string,
			doc: Y.Doc,
			opts?: {
				connect?: boolean;
				awareness?: Awareness;
				params?: Record<string, string>;
				WebSocketPolyfill?: typeof WebSocket;
				resyncInterval?: number;
				maxBackoffTime?: number;
				disableBc?: boolean;
			}
		);

		awareness: Awareness;
		wsconnected: boolean;
		synced: boolean;
		ws: WebSocket | null;
		roomname: string;
		doc: Y.Doc;

		on(event: string, listener: (...args: any[]) => void): void;
		off(event: string, listener: (...args: any[]) => void): void;
		once(event: string, listener: (...args: any[]) => void): void;
		emit(event: string, args: any[]): void;

		connect(): void;
		disconnect(): void;
		destroy(): void;
	}
}
