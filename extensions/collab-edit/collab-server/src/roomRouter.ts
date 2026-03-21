/*---------------------------------------------------------------------------------------------
 *  Collab Server — Room REST Router
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { Router, Request, Response } from 'express';
import { RoomManager } from './roomManager';

/**
 * Creates an Express Router with REST endpoints for room management.
 */
export function createRoomRouter(roomManager: RoomManager): Router {
	const router = Router();

	/**
	 * POST /api/create-room
	 * Body: { hostName: string }
	 * Response: { roomId: string }
	 */
	router.post('/create-room', (req: Request, res: Response) => {
		const { hostName } = req.body;
		if (!hostName || typeof hostName !== 'string') {
			res.status(400).json({ error: 'hostName is required' });
			return;
		}

		const room = roomManager.createRoom(hostName);
		res.json({ roomId: room.roomId });
	});

	/**
	 * POST /api/join-room
	 * Body: { roomId: string, userName: string }
	 * Response: { success: boolean, users: string[] }
	 */
	router.post('/join-room', (req: Request, res: Response) => {
		const { roomId, userName } = req.body;
		if (!roomId || !userName) {
			res.status(400).json({ error: 'roomId and userName are required' });
			return;
		}

		const room = roomManager.joinRoom(roomId, userName);
		if (!room) {
			res.status(404).json({ error: 'Room not found' });
			return;
		}

		res.json({
			success: true,
			users: Array.from(room.users)
		});
	});

	/**
	 * POST /api/leave-room
	 * Body: { roomId: string, userName: string }
	 * Response: { success: boolean }
	 */
	router.post('/leave-room', (req: Request, res: Response) => {
		const { roomId, userName } = req.body;
		if (!roomId || !userName) {
			res.status(400).json({ error: 'roomId and userName are required' });
			return;
		}

		const success = roomManager.leaveRoom(roomId, userName);
		res.json({ success });
	});

	/**
	 * GET /api/active-users/:roomId
	 * Response: { users: string[] }
	 */
	router.get('/active-users/:roomId', (req: Request, res: Response) => {
		const { roomId } = req.params;
		const users = roomManager.getActiveUsers(roomId);
		res.json({ users });
	});

	/**
	 * GET /api/rooms
	 * Response: { rooms: string[] }
	 */
	router.get('/rooms', (_req: Request, res: Response) => {
		const rooms = roomManager.getAllRoomIds();
		res.json({ rooms });
	});

	return router;
}
