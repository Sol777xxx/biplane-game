import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { Room, RoomError, RoomManager } from "../src/rooms.js";

function collect(emitter, name) {
	const seen = [];
	emitter.on(name, (x) => seen.push(x));
	return seen;
}

describe("Room", () => {
	it("join додає гравця, кидає join і оновлює roster", () => {
		const room = new Room({ id: "r", name: "R", max: 2 });
		const joined = collect(room, "join");
		room.join({ id: "1", name: "Оля" });
		assert.equal(joined.length, 1);
		assert.deepEqual(room.roster(), [{ id: "1", name: "Оля" }]);
		assert.equal(room.summary().players, 1);
	});

	it("повна кімната відхиляє гравця", () => {
		const room = new Room({ id: "r", name: "R", max: 1 });
		room.join({ id: "1", name: "A" });
		assert.throws(
			() => room.join({ id: "2", name: "B" }),
			(e) => e instanceof RoomError && e.code === "full",
		);
	});

	it("ім'я має бути унікальним без урахування регістру", () => {
		const room = new Room({ id: "r", name: "R" });
		room.join({ id: "1", name: "Оля" });
		assert.throws(
			() => room.join({ id: "2", name: "ОЛЯ" }),
			(e) => e.code === "name_taken",
		);
	});

	it("leave кидає leave, а на останньому ще й empty", () => {
		const room = new Room({ id: "r", name: "R" });
		const left = collect(room, "leave");
		const empty = collect(room, "empty");
		room.join({ id: "1", name: "A" });
		room.join({ id: "2", name: "B" });
		room.leave("1");
		assert.equal(empty.length, 0);
		room.leave("2");
		assert.equal(left.length, 2);
		assert.equal(empty.length, 1);
	});

	it("leave невідомого гравця нічого не робить", () => {
		const room = new Room({ id: "r", name: "R" });
		const empty = collect(room, "empty");
		assert.equal(room.leave("nope"), false);
		assert.equal(empty.length, 0);
	});

	it("chat кидає подію з автором і текстом", () => {
		const room = new Room({ id: "r", name: "R" });
		const chats = collect(room, "chat");
		room.join({ id: "1", name: "Оля" });
		room.chat("1", "привіт");
		assert.equal(chats[0].text, "привіт");
		assert.equal(chats[0].name, "Оля");
		assert.equal(chats[0].from, "1");
	});

	it("chat від гравця поза кімнатою це помилка", () => {
		const room = new Room({ id: "r", name: "R" });
		assert.throws(
			() => room.chat("x", "hi"),
			(e) => e.code === "not_in_room",
		);
	});

	it("пише події для логу в правильному порядку", () => {
		const room = new Room({ id: "r", name: "R", arena: { speed: 1 } });
		const events = collect(room, "event");
		room.join({ id: "1", name: "A" });
		room.join({ id: "2", name: "B" });
		room.chat("1", "hi");
		room.leave("1");
		room.leave("2");
		assert.deepEqual(
			events.map((e) => e.type),
			["match_start", "join", "join", "chat", "leave", "leave", "match_end"],
		);
		assert.ok(events.every((e) => typeof e.t === "number"));
		assert.equal(events[3].text, "hi");
	});

	it("matchstart лише для першого гравця й знову після спорожнення", () => {
		const room = new Room({ id: "r", name: "R" });
		const starts = collect(room, "matchstart");
		room.join({ id: "1", name: "A" });
		room.join({ id: "2", name: "B" });
		assert.equal(starts.length, 1);
		room.leave("1");
		room.leave("2");
		room.join({ id: "3", name: "C" });
		assert.equal(starts.length, 2);
	});

	it("відхилений join нічого не пише в лог", () => {
		const room = new Room({ id: "r", name: "R", max: 1 });
		room.join({ id: "1", name: "A" });
		const events = collect(room, "event");
		assert.throws(() => room.join({ id: "2", name: "B" }));
		assert.equal(events.length, 0);
	});
});

describe("RoomManager", () => {
	it("видаляє порожню кімнату, коли вийшов останній", () => {
		const m = new RoomManager();
		const room = m.create({ name: "R" });
		room.join({ id: "1", name: "A" });
		room.leave("1");
		assert.equal(m.get(room.id), undefined);
	});

	it("постійна кімната лишається порожньою", () => {
		const m = new RoomManager();
		const room = m.create({ name: "R", permanent: true });
		room.join({ id: "1", name: "A" });
		room.leave("1");
		assert.equal(m.get(room.id), room);
	});

	it("кімната, у яку ніхто не зайшов, зникає за TTL", async () => {
		const m = new RoomManager({ idleTtlMs: 20 });
		const room = m.create({ name: "R" });
		await sleep(80);
		assert.equal(m.get(room.id), undefined);
		m.dispose();
	});

	it("не створює більше за maxRooms", () => {
		const m = new RoomManager({ maxRooms: 1 });
		m.create({ name: "A" });
		assert.throws(
			() => m.create({ name: "B" }),
			(e) => e.code === "too_many_rooms",
		);
		m.dispose();
	});
});
