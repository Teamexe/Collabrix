/*---------------------------------------------------------------------------------------------
 *  Collab Server — Docker Manager
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import Docker from 'dockerode';

interface ContainerInfo {
	containerId: string;
	roomId: string;
	status: 'created' | 'running' | 'stopped';
}

/**
 * Docker container lifecycle management using dockerode.
 *
 * Creates per-room isolated dev environment containers with:
 * - Workspace volume mount
 * - CPU/memory limits
 * - Auto-cleanup on session end
 */
export class DockerManager {
	private readonly _docker: Docker;
	private readonly _containers: Map<string, ContainerInfo> = new Map();

	private static readonly DEFAULT_IMAGE = 'node:20-slim';
	private static readonly MEMORY_LIMIT = 512 * 1024 * 1024; // 512 MB
	private static readonly CPU_QUOTA = 50000; // 50% of one CPU

	constructor() {
		this._docker = new Docker();
	}

	/**
	 * Create a container for a room.
	 */
	async createContainer(roomId: string, workspacePath: string): Promise<string> {
		const existingInfo = this._containers.get(roomId);
		if (existingInfo) {
			return existingInfo.containerId;
		}

		try {
			const container = await this._docker.createContainer({
				Image: DockerManager.DEFAULT_IMAGE,
				name: `collab-room-${roomId.substring(0, 8)}`,
				Cmd: ['/bin/bash'],
				Tty: true,
				OpenStdin: true,
				AttachStdin: true,
				AttachStdout: true,
				AttachStderr: true,
				WorkingDir: '/workspace',
				HostConfig: {
					Binds: [`${workspacePath}:/workspace`],
					Memory: DockerManager.MEMORY_LIMIT,
					CpuQuota: DockerManager.CPU_QUOTA,
					AutoRemove: true,
				},
				Env: [
					`COLLAB_ROOM_ID=${roomId}`,
					'TERM=xterm-256color'
				]
			});

			const containerId = container.id;
			this._containers.set(roomId, {
				containerId,
				roomId,
				status: 'created'
			});

			console.log(`[docker] Container created for room ${roomId}: ${containerId.substring(0, 12)}`);
			return containerId;
		} catch (err) {
			console.error(`[docker] Failed to create container for room ${roomId}:`, err);
			throw err;
		}
	}

	/**
	 * Start a room's container.
	 */
	async startContainer(roomId: string): Promise<void> {
		const info = this._containers.get(roomId);
		if (!info) {
			throw new Error(`No container for room ${roomId}`);
		}

		try {
			const container = this._docker.getContainer(info.containerId);
			await container.start();
			info.status = 'running';
			console.log(`[docker] Container started for room ${roomId}`);
		} catch (err) {
			console.error(`[docker] Failed to start container for room ${roomId}:`, err);
			throw err;
		}
	}

	/**
	 * Stop and remove a room's container.
	 */
	async stopContainer(roomId: string): Promise<void> {
		const info = this._containers.get(roomId);
		if (!info) {
			return;
		}

		try {
			const container = this._docker.getContainer(info.containerId);
			await container.stop({ t: 5 });
			info.status = 'stopped';
			this._containers.delete(roomId);
			console.log(`[docker] Container stopped for room ${roomId}`);
		} catch (err) {
			// Container may have already been removed (AutoRemove)
			this._containers.delete(roomId);
			console.log(`[docker] Container cleanup for room ${roomId} (may have auto-removed)`);
		}
	}

	/**
	 * Execute a command inside a room's container.
	 */
	async execInContainer(roomId: string, command: string[]): Promise<string> {
		const info = this._containers.get(roomId);
		if (!info) {
			throw new Error(`No container for room ${roomId}`);
		}

		const container = this._docker.getContainer(info.containerId);
		const exec = await container.exec({
			Cmd: command,
			AttachStdout: true,
			AttachStderr: true,
			Tty: false
		});

		return new Promise<string>((resolve, reject) => {
			exec.start({ hijack: true, stdin: false }, (err: Error | null, stream: NodeJS.ReadableStream | undefined) => {
				if (err) {
					reject(err);
					return;
				}
				if (!stream) {
					resolve('');
					return;
				}

				let output = '';
				stream.on('data', (chunk: Buffer) => {
					output += chunk.toString();
				});
				stream.on('end', () => resolve(output));
				stream.on('error', reject);
			});
		});
	}

	/**
	 * Get an interactive shell stream attached to a room's container.
	 * Returns exec instance that can be used with node-pty or WebSocket.
	 */
	async getContainerShell(roomId: string): Promise<Docker.Exec> {
		const info = this._containers.get(roomId);
		if (!info) {
			throw new Error(`No container for room ${roomId}`);
		}

		const container = this._docker.getContainer(info.containerId);
		const exec = await container.exec({
			Cmd: ['/bin/bash'],
			AttachStdin: true,
			AttachStdout: true,
			AttachStderr: true,
			Tty: true
		});

		return exec;
	}

	/**
	 * Check if a room has a running container.
	 */
	hasContainer(roomId: string): boolean {
		const info = this._containers.get(roomId);
		return info?.status === 'running';
	}

	/**
	 * Dispose — stop all containers.
	 */
	dispose(): void {
		for (const roomId of this._containers.keys()) {
			this.stopContainer(roomId).catch((err) => {
				console.error(`[docker] Error stopping container for room ${roomId}:`, err);
			});
		}
	}
}
