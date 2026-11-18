import type { Logger } from "./logger.ts";
import { Match, type MatchOptions, type MatchStats } from "./match.ts";
import type { Room, RoomManager } from "./rooms.ts";

export type MatchesOptions = Omit<MatchOptions, "room" | "log"> & {
	readonly rooms: RoomManager;
	readonly log: Logger;
};

export interface Matches {
	attach(room: Room): Match;
	get(id: string): Match | undefined;
	stats(): MatchStats[];
	close(): void;
}

// Усі Match сервера: по одному на кімнату. Записи кімнат, яких уже немає, прибираються.
export function createMatches({
	rooms,
	log,
	...options
}: MatchesOptions): Matches {
	const byRoom = new Map<string, Match>();

	function prune(): void {
		for (const [id, match] of byRoom) {
			if (rooms.get(id)) continue;
			match.dispose();
			byRoom.delete(id);
		}
	}

	return {
		attach(room) {
			prune();
			const existing = byRoom.get(room.id);
			if (existing) return existing;
			const match = new Match({ room, log, ...options });
			byRoom.set(room.id, match);
			return match;
		},
		get(id) {
			return byRoom.get(id);
		},
		stats() {
			prune();
			return [...byRoom.values()].map((match) => match.stats());
		},
		close() {
			for (const match of byRoom.values()) match.dispose();
			byRoom.clear();
		},
	};
}
