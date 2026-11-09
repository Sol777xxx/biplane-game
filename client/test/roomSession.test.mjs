import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { after, before, describe, it } from "node:test";
import { createApp } from "../../server/src/app.js";
import { silentLogger } from "../../server/src/logger.js";
import { RoomManager } from "../../server/src/rooms.js";
import { JoinError, joinRoom } from "../src/net/roomSession.js";
import { waitFor } from "./helpers.mjs";

let app;
let rooms;
let url;

before(async () => {
	rooms = new RoomManager();
	const config = {
		port: 0,
		host: "127.0.0.1",
		clientDir: tmpdir(),
		logDir: tmpdir(),
	};
	app = createApp(config, { rooms, log: silentLogger, matchLog: false });
	const { port } = await app.listen();
	url = `ws://127.0.0.1:${port}/ws`;
});
after(() => app.close());

const newRoom = (max = 4) =>
	rooms.create({ name: "T", max, permanent: true }).id;
const once = (target, type) =>
	new Promise((resolve) =>
		target.addEventListener(type, (e) => resolve(e.detail), { once: true }),
	);

describe("joinRoom (наскрізно з сервером)", { timeout: 10_000 }, () => {
	it("двоє бачать один одного й чат", async () => {
		const room = newRoom();
		const a = await joinRoom(url, { room, name: "Оля" });
		assert.deepEqual(
			a.players.map((p) => p.name),
			["Оля"],
		);

		const aSeesB = once(a, "roster");
		const b = await joinRoom(url, { room, name: "Тарас" });
		assert.equal((await aSeesB).length, 2);

		const atB = once(b, "chat");
		a.chat("привіт");
		const m = await atB;
		assert.equal(m.text, "привіт");
		assert.equal(m.name, "Оля");
		a.leave();
		b.leave();
	});

	it("повна кімната: JoinError 4006", async () => {
		const room = newRoom(1);
		const a = await joinRoom(url, { room, name: "Оля" });
		await assert.rejects(
			joinRoom(url, { room, name: "Тарас" }),
			(e) => e instanceof JoinError && e.code === 4006,
		);
		a.leave();
	});

	it("сервер недоступний: вхід завершується таймаутом, а не висить", async () => {
		await assert.rejects(
			joinRoom("ws://127.0.0.1:1/ws", {
				room: "x",
				name: "A",
				signal: AbortSignal.timeout(300),
				connection: { baseMs: 10, maxMs: 30 },
			}),
			(e) => e.name === "TimeoutError",
		);
	});

	it("після обриву сам повертається в кімнату", async () => {
		const room = newRoom();
		const a = await joinRoom(url, {
			room,
			name: "Оля",
			connection: { baseMs: 10, maxMs: 30 },
		});
		const states = [];
		a.addEventListener("status", (e) => states.push(e.detail.state));

		for (const ws of app.sockets.wss.clients) ws.terminate();
		await waitFor(() => states.includes("online"));

		assert.ok(states.includes("reconnecting"));
		assert.equal(rooms.get(room).players.size, 1);
		a.leave();
	});
});
