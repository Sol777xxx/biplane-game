import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { after, afterEach, before, describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { decodeSnapshot, encodeInput } from "biplane-shared/codec/binary.js";
import WebSocket from "ws";
import { createApp } from "../src/app.js";
import { silentLogger } from "../src/logger.js";
import { RoomManager } from "../src/rooms.js";

let app;
let rooms;
let url;
const open = [];

before(async () => {
	rooms = new RoomManager();
	app = createApp(
		{ port: 0, host: "127.0.0.1", clientDir: tmpdir(), logDir: tmpdir() },
		{ rooms, log: silentLogger, matchLog: false, game: true },
	);
	const { port } = await app.listen();
	url = `ws://127.0.0.1:${port}/ws`;
});
afterEach(() => {
	for (const c of open.splice(0)) c.ws.terminate();
});
after(() => app.close());

const newRoom = () => rooms.create({ name: "B", max: 8, permanent: true }).id;

async function waitFor(condition, ms = 3000) {
	const end = Date.now() + ms;
	while (!condition()) {
		if (Date.now() > end) throw new Error("waitFor: час вийшов");
		await sleep(5);
	}
}

// сокет; з room одразу робить join. frames: усі кадри { data, isBinary }
async function connect({ query = "", room = null, name = "p" } = {}) {
	const ws = new WebSocket(`${url}${query}`);
	const frames = [];
	const closed = new Promise((resolve) =>
		ws.on("close", (code) => resolve(code)),
	);
	ws.on("message", (data, isBinary) => frames.push({ data, isBinary }));
	ws.on("error", () => {});
	await new Promise((resolve) => ws.once("open", resolve));
	const c = { ws, frames, closed };
	open.push(c);
	if (room) {
		ws.send(JSON.stringify({ v: 1, type: "join", room, name }));
		await waitFor(() => texts(c, "joined").length === 1);
	}
	return c;
}

const texts = (c, type) =>
	c.frames
		.filter((f) => !f.isBinary)
		.map((f) => JSON.parse(f.data.toString()))
		.filter((m) => m.type === type);
const binaries = (c) => c.frames.filter((f) => f.isBinary);

describe("бінарний input", { timeout: 15_000 }, () => {
	it("доходить до кімнати так само, як JSON-input", async () => {
		const id = newRoom();
		const room = rooms.get(id);
		const c = await connect({ room: id });
		const you = texts(c, "joined")[0].you.id;
		const got = [];
		const onInput = (e) => got.push(e);
		room.on("input", onInput);
		try {
			c.ws.send(encodeInput(5, { right: true, fire: true }));
			await waitFor(() => got.length === 1);
			assert.deepEqual(got[0], {
				playerId: you,
				seq: 5,
				keys: { up: false, down: false, left: false, right: true, fire: true },
			});
		} finally {
			room.off("input", onInput);
		}
	});

	it("зламані кадри версії 1: 4000", async () => {
		const good = Uint8Array.from(encodeInput(1, {}));
		const set = (i, v) => {
			const b = Uint8Array.from(good);
			b[i] = v;
			return b;
		};
		const bad = [
			good.subarray(0, 6),
			Uint8Array.of(...good, 0),
			set(1, 2), // тип «знімок» від клієнта
			set(6, 0x20), // зарезервований біт
		];
		for (const frame of bad) {
			const c = await connect({ room: newRoom() });
			c.ws.send(frame);
			assert.equal(await c.closed, 4000, [...frame].join());
		}
	});

	it("чужий формат (перший байт не 1): 1003", async () => {
		const foreign = [
			Buffer.from("hello"),
			new Uint8Array(0),
			Uint8Array.of(2, 1, 0, 0, 0, 0, 0),
		];
		for (const frame of foreign) {
			const c = await connect({ room: newRoom() });
			c.ws.send(frame);
			assert.equal(await c.closed, 1003, [...frame].join());
		}
	});

	it("до join: 4003", async () => {
		const c = await connect();
		c.ws.send(encodeInput(1, {}));
		assert.equal(await c.closed, 4003);
	});

	it("ліміт input діє й для бінарних кадрів: 4008", async () => {
		const id = newRoom();
		const room = rooms.get(id);
		const c = await connect({ room: id });
		const got = [];
		const onInput = (e) => got.push(e.seq);
		room.on("input", onInput);
		try {
			for (let seq = 1; seq <= 80; seq++) c.ws.send(encodeInput(seq, {}));
			assert.equal(await c.closed, 4008);
			assert.ok(got.length >= 60 && got.length < 80, `дійшло ${got.length}`);
		} finally {
			room.off("input", onInput);
		}
	});
});

describe("кодек знімків за параметром адреси", { timeout: 15_000 }, () => {
	it("?codec=binary: знімки бінарні, керування текстове", async () => {
		const c = await connect({ query: "?codec=binary", room: newRoom() });
		await waitFor(() => binaries(c).length >= 5);
		assert.equal(texts(c, "snapshot").length, 0);
		const snap = decodeSnapshot(binaries(c).at(-1).data);
		assert.equal(snap.type, "snapshot");
		assert.equal(snap.players.length, 1);
		assert.equal(snap.ships.length, 1);
		assert.equal(snap.ack, 0);
		assert.ok(snap.tick >= 5);
	});

	it("без параметра й з невідомим кодеком знімки це JSON", async () => {
		for (const query of ["", "?codec=xml", "?codec=toString"]) {
			const c = await connect({ query, room: newRoom() });
			await waitFor(() => texts(c, "snapshot").length >= 3);
			assert.equal(binaries(c).length, 0, query);
		}
	});

	it("ack у бінарному знімку росте з бінарними input", async () => {
		const c = await connect({ query: "?codec=binary", room: newRoom() });
		for (let seq = 1; seq <= 3; seq++)
			c.ws.send(encodeInput(seq, { right: true }));
		await waitFor(() => {
			const last = binaries(c).at(-1);
			return last && decodeSnapshot(last.data).ack === 3;
		});
	});

	it("JSON-клієнт може слати бінарний input, бінарний клієнт JSON-input", async () => {
		const id = newRoom();
		const room = rooms.get(id);
		const json = await connect({ room: id, name: "j" });
		const bin = await connect({ query: "?codec=binary", room: id, name: "b" });
		const got = [];
		const onInput = (e) => got.push(e.seq);
		room.on("input", onInput);
		try {
			json.ws.send(encodeInput(1, {}));
			bin.ws.send(
				JSON.stringify({
					v: 1,
					type: "input",
					seq: 2,
					up: false,
					down: false,
					left: false,
					right: false,
					fire: false,
				}),
			);
			await waitFor(() => got.length === 2);
			assert.deepEqual([...got].sort(), [1, 2]);
		} finally {
			room.off("input", onInput);
		}
	});
});
