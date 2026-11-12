import { Match } from "./match.js";

// Усі Match сервера: по одному на кімнату. Записи кімнат, яких уже немає, прибираються.
export function createMatches({ rooms, log, ...options }) {
	const byRoom = new Map();

	function prune() {
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
