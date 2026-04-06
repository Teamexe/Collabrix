/*---------------------------------------------------------------------------------------------
 *  Collab Server — Room Manager
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';

const PERSIST_FILE = path.join(process.cwd(), '.collab-rooms.json');

export interface Room {
	roomId: string;
	hostName: string;
	users: Set<string>;
	createdAt: Date;
	dockerContainerId?: string;
}

/**
 * In-memory room management with JSON persistence.
 * Rooms survive server restarts.
 */
export class RoomManager {
	private readonly _rooms: Map<string, Room> = new Map();

	constructor() {
		this._load();
	}

	private _load(): void {
		try {
			if (fs.existsSync(PERSIST_FILE)) {
				const raw = JSON.parse(fs.readFileSync(PERSIST_FILE, 'utf-8')) as Array<{
					roomId: string; hostName: string; users: string[]; createdAt: string;
				}>;
				for (const r of raw) {
					this._rooms.set(r.roomId, {
						roomId: r.roomId,
						hostName: r.hostName,
						users: new Set(r.users),
						createdAt: new Date(r.createdAt)
					});
				}
				console.log(`[server] Loaded ${this._rooms.size} persisted rooms`);
			}
		} catch {
			console.warn('[server] Could not load persisted rooms, starting fresh');
		}
	}

	private _save(): void {
		try {
			const data = Array.from(this._rooms.values()).map(r => ({
				roomId: r.roomId,
				hostName: r.hostName,
				users: Array.from(r.users),
				createdAt: r.createdAt.toISOString()
			}));
			fs.writeFileSync(PERSIST_FILE, JSON.stringify(data, null, 2));
		} catch (err) {
			console.warn('[server] Failed to persist rooms:', err);
		}
	}

	createRoom(hostName: string): Room {
		const roomId = uuidv4();
		const room: Room = {
			roomId,
			hostName,
			users: new Set([hostName]),
			createdAt: new Date()
		};
		this._rooms.set(roomId, room);
		this._save();
		console.log(`[server] Room created: ${roomId} by ${hostName}`);
		return room;
	}

	joinRoom(roomId: string, userName: string): Room | null {
		const room = this._rooms.get(roomId);
		if (!room) return null;
		room.users.add(userName);
		this._save();
		console.log(`[server] ${userName} joined room ${roomId}`);
		return room;
	}

	leaveRoom(roomId: string, userName: string): boolean {
		const room = this._rooms.get(roomId);
		if (!room) return false;
		room.users.delete(userName);
		console.log(`[server] ${userName} left room ${roomId}`);
		if (room.users.size === 0) {
			this._rooms.delete(roomId);
			console.log(`[server] Room ${roomId} destroyed (empty)`);
		}
		this._save();
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
