/*---------------------------------------------------------------------------------------------
 *  Collab Server — Room Manager
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { v4 as uuidv4 } from 'uuid';

export interface Room {
	roomId: string;
	hostName: string;
	users: Set<string>;
	createdAt: Date;
	dockerContainerId?: string;
}

/**
 * In-memory room management.
 * Tracks rooms, their host, and active users.
 */
export class RoomManager {
	private readonly _rooms: Map<string, Room> = new Map();

	/**
	 * Create a new collaboration room.
	 */
	createRoom(hostName: string): Room {
		const roomId = uuidv4();
		const room: Room = {
			roomId,
			hostName,
			users: new Set([hostName]),
			createdAt: new Date()
		};
		this._rooms.set(roomId, room);
		console.log(`[server] Room created: ${roomId} by ${hostName}`);
		return room;
	}

	/**
	 * Join an existing room.
	 */
	joinRoom(roomId: string, userName: string): Room | null {
		const room = this._rooms.get(roomId);
		if (!room) {
			return null;
		}
		room.users.add(userName);
		console.log(`[server] ${userName} joined room ${roomId}`);
		return room;
	}

	/**
	 * Leave a room. If room becomes empty, it is destroyed.
	 */
	leaveRoom(roomId: string, userName: string): boolean {
		const room = this._rooms.get(roomId);
		if (!room) {
			return false;
		}
		room.users.delete(userName);
		console.log(`[server] ${userName} left room ${roomId}`);

		if (room.users.size === 0) {
			this._rooms.delete(roomId);
			console.log(`[server] Room ${roomId} destroyed (empty)`);
		}
		return true;
	}

	/**
	 * Get active users in a room.
	 */
	getActiveUsers(roomId: string): string[] {
		const room = this._rooms.get(roomId);
		if (!room) {
			return [];
		}
		return Array.from(room.users);
	}

	/**
	 * Get room info.
	 */
	getRoom(roomId: string): Room | undefined {
		return this._rooms.get(roomId);
	}

	/**
	 * Check if a room exists.
	 */
	hasRoom(roomId: string): boolean {
		return this._rooms.has(roomId);
	}

	/**
	 * Get all room IDs.
	 */
	getAllRoomIds(): string[] {
		return Array.from(this._rooms.keys());
	}

	/**
	 * Set Docker container ID for a room.
	 */
	setContainerId(roomId: string, containerId: string): void {
		const room = this._rooms.get(roomId);
		if (room) {
			room.dockerContainerId = containerId;
		}
	}
}
