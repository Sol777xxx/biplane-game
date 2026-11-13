import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { after, before, describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { createApp } from "../../server/src/app.js";
import { silentLogger } from "../../server/src/logger.js";
import { RoomManager } from "../../server/src/rooms.js";
import { joinRoom, RoomSession } from "../src/net/roomSession.js";
import { createSnapshotView } from "../src/net/snapshotView.js";
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
	app = createApp(config, {
		rooms,
		log: silentLogger,
		matchLog: false,
		game: true,
	});
	const { port } = await app.listen();
	url = `ws://127.0.0.1:${port}/ws`;
});
after(() => app.close());

const newRoom = () => rooms.create({ name: "T", max: 4, permanent: true }).id;

describe("input і знімки через RoomSession", { timeout: 15_000 }, () => {
	it("sendInput: seq росте з 1, ack повертається у знімку", async () => {
		const s = await joinRoom(url, { room: newRoom(), name: "Оля" });
		const seqs = [];
		for (let i = 0; i < 5; i++) {
			seqs.push(s.sendInput({ right: true }));
			await sleep(40);
		}
		assert.deepEqual(seqs, [1, 2, 3, 4, 5]);
		await waitFor(() => s.snapshot?.ack === 5, 3000);
		assert.equal(s.snapshot.type, "snapshot");
		s.leave();
	});

	it("корабель у знімку рухається від input, view його показує", async () => {
		const s = await joinRoom(url, { room: newRoom(), name: "Оля" });
		for (let i = 0; i < 6; i++) {
			s.sendInput({ right: true });
			await sleep(40);
		}
		await waitFor(() => s.snapshot?.ack === 6, 3000);
		const view = createSnapshotView({ you: () => s.you.id });
		view.apply(s.snapshot);
		const { ship, player } = view.me();
		assert.ok(ship.vel.x > 0);
		assert.equal(player.id, s.you.id);
		assert.equal(view.ack, 6);
		s.leave();
	});

	it("подія snapshot доходить слухачам сеансу", async () => {
		const s = await joinRoom(url, { room: newRoom(), name: "Оля" });
		const ticks = [];
		s.addEventListener("snapshot", (e) => ticks.push(e.detail.tick));
		await waitFor(() => ticks.length >= 5, 3000);
		assert.deepEqual(
			ticks,
			[...ticks].sort((a, b) => a - b),
		);
		s.leave();
	});

	it("без з'єднання input не надсилається й не стоїть у черзі", () => {
		const s = new RoomSession("ws://127.0.0.1:1/ws", { room: "x", name: "A" });
		assert.equal(s.sendInput({ right: true }), 0);
	});

	it("після leave sendInput повертає 0", async () => {
		const s = await joinRoom(url, { room: newRoom(), name: "Оля" });
		assert.equal(s.sendInput({}), 1);
		s.leave();
		assert.equal(s.sendInput({}), 0);
	});

	it("після перепідключення seq починається з 1", async () => {
		const s = await joinRoom(url, {
			room: newRoom(),
			name: "Оля",
			connection: { baseMs: 10, maxMs: 30 },
		});
		assert.equal(s.sendInput({}), 1);
		assert.equal(s.sendInput({}), 2);

		const states = [];
		s.addEventListener("status", (e) => states.push(e.detail.state));
		for (const ws of app.sockets.wss.clients) ws.terminate();
		await waitFor(() => states.includes("online"), 3000);

		assert.equal(s.sendInput({ right: true }), 1);
		s.leave();
	});
});
