import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { after, before, describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import WebSocket from "ws";
import { createApp } from "../src/app.js";
import { silentLogger } from "../src/logger.js";
import { RoomManager } from "../src/rooms.js";

let app;
let rooms;
let wsUrl;
let httpUrl;
const open = [];

before(async () => {
	rooms = new RoomManager();
	app = createApp(
		{ port: 0, host: "127.0.0.1", clientDir: tmpdir(), logDir: tmpdir() },
		{ rooms, log: silentLogger, matchLog: false, game: true },
	);
	const { port } = await app.listen();
	wsUrl = `ws://127.0.0.1:${port}/ws`;
	httpUrl = `http://127.0.0.1:${port}`;
});
after(async () => {
	for (const ws of open) ws.terminate();
	await app.close();
});

async function waitFor(condition, ms = 3000) {
	const end = Date.now() + ms;
	while (!(await condition())) {
		if (Date.now() > end) throw new Error("waitFor: час вийшов");
		await sleep(10);
	}
}

async function join(roomId, name) {
	const ws = new WebSocket(wsUrl);
	open.push(ws);
	const messages = [];
	ws.on("message", (data) => messages.push(JSON.parse(data.toString())));
	ws.on("error", () => {});
	await new Promise((resolve) => ws.once("open", resolve));
	ws.send(JSON.stringify({ v: 1, type: "join", room: roomId, name }));
	await waitFor(() => messages.some((m) => m.type === "joined"));
	const you = messages.find((m) => m.type === "joined").you;
	return {
		ws,
		you,
		messages,
		snapshots: () => messages.filter((m) => m.type === "snapshot"),
	};
}

const stats = async (roomId) =>
	(await (await fetch(`${httpUrl}/api/stats`)).json()).rooms.find(
		(r) => r.id === roomId,
	);

describe("гра на сервері", { timeout: 15_000 }, () => {
	it("знімки йдуть ~30/с; input рухає корабель, ack росте", async () => {
		const room = rooms.create({ name: "G1", max: 4, permanent: true });
		const c = await join(room.id, "Оля");

		let seq = 0;
		const timer = setInterval(() => {
			if (seq >= 30) return;
			seq++;
			c.ws.send(
				JSON.stringify({
					v: 1,
					type: "input",
					seq,
					up: false,
					down: false,
					left: false,
					right: true,
					fire: false,
				}),
			);
		}, 1000 / 30);

		try {
			await waitFor(() => c.snapshots().at(-1)?.ack === 30);
		} finally {
			clearInterval(timer);
		}

		const snaps = c.snapshots();
		assert.ok(snaps.length >= 20, `знімків: ${snaps.length}`);
		const ticks = snaps.map((s) => s.tick);
		assert.deepEqual(
			ticks,
			[...ticks].sort((a, b) => a - b),
		);
		const acks = snaps.map((s) => s.ack);
		assert.deepEqual(
			acks,
			[...acks].sort((a, b) => a - b),
		);

		const mine = snaps.at(-1).ships.find((s) => s.player === c.you.id);
		assert.ok(mine.vx > 0);
		assert.equal(snaps.at(-1).v, 1);
		assert.equal(snaps.at(-1).type, "snapshot");
	});

	it("два гравці бачать один одного, чужий ack не змішується", async () => {
		const room = rooms.create({ name: "G2", max: 4, permanent: true });
		const a = await join(room.id, "Оля");
		const b = await join(room.id, "Тарас");
		a.ws.send(
			JSON.stringify({
				v: 1,
				type: "input",
				seq: 1,
				up: false,
				down: false,
				left: false,
				right: true,
				fire: false,
			}),
		);
		await waitFor(() => a.snapshots().at(-1)?.ack === 1);
		await waitFor(() => b.snapshots().at(-1)?.ships.length === 2);
		assert.equal(b.snapshots().at(-1).ack, 0);
		const ids = b
			.snapshots()
			.at(-1)
			.ships.map((s) => s.player)
			.sort();
		assert.deepEqual(ids, [a.you.id, b.you.id].sort());
	});

	it("/api/stats: тіки, виміри, running; після виходу матч зупиняється", async () => {
		const room = rooms.create({ name: "G3", max: 4, permanent: true });
		const idle = await stats(room.id);
		assert.equal(idle.running, false);
		assert.equal(idle.ticks, 0);

		const c = await join(room.id, "Оля");
		await waitFor(() => c.snapshots().length >= 10);
		const live = await stats(room.id);
		assert.equal(live.running, true);
		assert.equal(live.players, 1);
		assert.equal(live.tickRate, 30);
		assert.ok(live.ticks >= 10);
		assert.equal(live.tickMs.n, live.ticks);
		assert.ok(live.lateMs.max >= 0);

		c.ws.close(1000, "bye");
		await waitFor(async () => (await stats(room.id)).running === false);
	});

	it("/api/stats приймає лише GET", async () => {
		const r = await fetch(`${httpUrl}/api/stats`, { method: "POST" });
		assert.equal(r.status, 405);
		assert.equal(r.headers.get("allow"), "GET");
	});
});
