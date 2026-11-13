import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { after, before, describe, it } from "node:test";
import { makeInput } from "biplane-shared/protocol/index.js";
import { createApp } from "../../server/src/app.js";
import { silentLogger } from "../../server/src/logger.js";
import { RoomManager } from "../../server/src/rooms.js";
import { joinRoom, RoomSession } from "../src/net/roomSession.js";
import { waitFor } from "./helpers.mjs";

const apps = [];
const sessions = [];

async function startApp(enableNetsim) {
	const rooms = new RoomManager();
	const config = {
		port: 0,
		host: "127.0.0.1",
		clientDir: tmpdir(),
		logDir: tmpdir(),
		enableNetsim,
	};
	const app = createApp(config, {
		rooms,
		log: silentLogger,
		matchLog: false,
		game: true,
	});
	const { port } = await app.listen();
	apps.push(app);
	return {
		url: `ws://127.0.0.1:${port}/ws`,
		room: () => rooms.create({ name: "T", max: 4, permanent: true }).id,
	};
}

let on;
let off;
before(async () => {
	on = await startApp(true);
	off = await startApp(false);
});
after(async () => {
	for (const s of sessions) s.leave();
	await Promise.all(apps.map((app) => app.close()));
});

async function join(server, query = "") {
	const s = await joinRoom(`${server.url}${query}`, {
		room: server.room(),
		name: "Оля",
	});
	sessions.push(s);
	return s;
}

const once = (target, type) =>
	new Promise((resolve) =>
		target.addEventListener(type, (e) => resolve(e.detail), { once: true }),
	);

const byteLength = (message) =>
	new TextEncoder().encode(JSON.stringify(message)).length;

describe("RoomSession: ping, трафік, netsim", { timeout: 20_000 }, () => {
	it("ping дає pong із RTT, не меншим за lag", async () => {
		const s = await join(on, "?lag=100");
		const pong = once(s, "pong");
		assert.equal(s.ping(), true);
		const { rtt } = await pong;
		assert.ok(rtt >= 90, `RTT ${rtt}`);
		assert.ok(rtt < 500, `RTT ${rtt}`);
	});

	it("сервер повідомляє про штучну мережу, коли вона дозволена", async () => {
		const s = await join(on, "?lag=100&jitter=30&loss=2");
		await waitFor(() => s.netsim !== null);
		assert.deepEqual(s.netsim, {
			enabled: true,
			lag: 100,
			jitter: 30,
			loss: 2,
		});
	});

	it("setNetsim міняє затримку наживо", async () => {
		const s = await join(on);
		const first = once(s, "pong");
		s.ping();
		assert.ok((await first).rtt < 80);

		s.setNetsim({ lag: 200, jitter: 0, loss: 0 });
		await waitFor(() => s.netsim?.lag === 200);
		const slow = once(s, "pong");
		s.ping();
		assert.ok((await slow).rtt >= 180);

		s.setNetsim({ lag: 0, jitter: 0, loss: 0 });
		await waitFor(() => s.netsim?.lag === 0);
		const back = once(s, "pong");
		s.ping();
		assert.ok((await back).rtt < 80);
	});

	it("без ENABLE_NETSIM сервер відповідає enabled: false", async () => {
		const s = await join(off, "?lag=300");
		assert.equal(s.netsim, null);
		s.setNetsim({ lag: 200 });
		await waitFor(() => s.netsim !== null);
		assert.equal(s.netsim.enabled, false);
		assert.equal(s.netsim.lag, 0);
	});

	it("traffic рахує байти точно: join, потім input", async () => {
		const s = await join(on);
		const joinMessage = { v: 1, type: "join", room: s.room.id, name: "Оля" };
		const t0 = s.traffic;
		assert.equal(t0.bytesOut, byteLength(joinMessage));
		assert.equal(t0.msgsOut, 1);
		assert.ok(t0.bytesIn > 0);
		assert.ok(t0.msgsIn >= 1);

		assert.equal(s.sendInput({ right: true }), 1);
		const t1 = s.traffic;
		assert.equal(
			t1.bytesOut - t0.bytesOut,
			byteLength(makeInput(1, { right: true })),
		);
		assert.equal(t1.msgsOut, 2);
	});

	it("traffic: знімки збільшують bytesIn", async () => {
		const s = await join(on);
		const { bytesIn, msgsIn } = s.traffic;
		await waitFor(() => s.traffic.msgsIn >= msgsIn + 4, 3000);
		assert.ok(s.traffic.bytesIn > bytesIn + 500);
	});

	it("lastSeq росте з кожним input", async () => {
		const s = await join(on);
		assert.equal(s.lastSeq, 0);
		s.sendInput({});
		s.sendInput({});
		s.sendInput({});
		assert.equal(s.lastSeq, 3);
	});

	it("без з'єднання ping не надсилається й не стоїть у черзі", () => {
		const s = new RoomSession("ws://127.0.0.1:1/ws", { room: "x", name: "A" });
		assert.equal(s.ping(), false);
	});
});
