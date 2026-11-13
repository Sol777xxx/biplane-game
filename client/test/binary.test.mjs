import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { after, before, describe, it, mock } from "node:test";
import { encodeSnapshot } from "biplane-shared/codec/binary.js";
import { make } from "biplane-shared/protocol/index.js";
import { createScenario } from "biplane-shared/sim/scenario.js";
import { takeSnapshot } from "biplane-shared/sim/snapshot.js";
import { WebSocketServer } from "ws";
import { createApp } from "../../server/src/app.js";
import { silentLogger } from "../../server/src/logger.js";
import { RoomManager } from "../../server/src/rooms.js";
import { Connection } from "../src/net/connection.js";
import { joinRoom } from "../src/net/roomSession.js";
import { waitFor } from "./helpers.mjs";

const viaJson = (m) => JSON.parse(JSON.stringify(m));

// ---------- Connection проти простого ws-сервера ----------
const servers = [];
const conns = [];

async function wsServer(onConnection) {
	const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
	await new Promise((resolve) => wss.once("listening", resolve));
	servers.push(wss);
	const received = [];
	wss.on("connection", (ws) => {
		ws.on("message", (data, isBinary) => received.push({ data, isBinary }));
		onConnection?.(ws);
	});
	return { received, url: `ws://127.0.0.1:${wss.address().port}` };
}

function client(url) {
	const c = new Connection(url);
	conns.push(c);
	return c;
}

function sampleMessage() {
	const sc = createScenario({ seed: 2 });
	for (let i = 0; i < 60; i++) sc.step();
	return make("snapshot", { ...takeSnapshot(sc.game), events: [], ack: 3 });
}

describe("Connection: бінарні кадри", { timeout: 15_000 }, () => {
	it("бінарний знімок декодується й іде обробникам snapshot", async () => {
		const msg = sampleMessage();
		const frame = encodeSnapshot(msg);
		const { url } = await wsServer((ws) => ws.send(frame));
		const c = client(url);
		const got = [];
		c.on("snapshot", (m) => got.push(m));
		c.connect();
		await waitFor(() => got.length === 1);
		assert.deepStrictEqual(got[0], viaJson(msg));
		assert.equal(c.traffic.bytesIn, frame.byteLength);
		assert.equal(c.traffic.msgsIn, 1);
	});

	it("зламані й чужі бінарні кадри ігноруються, з'єднання живе", async () => {
		const warn = mock.method(console, "warn", () => {});
		try {
			const frame = encodeSnapshot(sampleMessage());
			const { url } = await wsServer((ws) => {
				ws.send(Uint8Array.of(9, 9, 9)); // чужа версія
				ws.send(Uint8Array.of(1, 2)); // знімок без тіла
				ws.send(frame.subarray(0, 20)); // обрізаний
				ws.send(Uint8Array.of(1, 1, 0, 0, 0, 0, 0)); // input від сервера
				ws.send(JSON.stringify({ type: "chat", text: "ok" }));
			});
			const c = client(url);
			const snaps = [];
			const chats = [];
			c.on("snapshot", (m) => snaps.push(m));
			c.on("chat", (m) => chats.push(m));
			c.connect();
			await waitFor(() => chats.length === 1);
			assert.equal(snaps.length, 0);
			assert.equal(c.state, "open");
			assert.equal(warn.mock.callCount(), 4);
		} finally {
			warn.mock.restore();
		}
	});

	it("sendBinary: у відкритому з'єднанні йде бінарним кадром, у закритому не стає в чергу", async () => {
		const { received, url } = await wsServer();
		const c = client(url);
		assert.equal(c.sendBinary(Uint8Array.of(1, 2, 3)), "dropped");
		assert.equal(c.queued, 0);
		c.connect();
		await waitFor(() => c.state === "open");
		assert.equal(c.sendBinary(Uint8Array.of(1, 2, 3)), "sent");
		await waitFor(() => received.length === 1);
		assert.equal(received[0].isBinary, true);
		assert.deepEqual([...received[0].data], [1, 2, 3]);
		assert.equal(c.traffic.bytesOut, 3);
		assert.equal(c.traffic.msgsOut, 1);
	});
});

// ---------- RoomSession проти справжнього сервера ----------
let app;
let rooms;
let url;

before(async () => {
	rooms = new RoomManager();
	app = createApp(
		{ port: 0, host: "127.0.0.1", clientDir: tmpdir(), logDir: tmpdir() },
		{ rooms, log: silentLogger, matchLog: false, game: true },
	);
	const { port } = await app.listen();
	url = `ws://127.0.0.1:${port}/ws`;
});
after(async () => {
	for (const c of conns) c.close();
	for (const wss of servers) {
		for (const ws of wss.clients) ws.terminate();
		wss.close();
	}
	await app.close();
});

const newRoom = () => rooms.create({ name: "T", max: 4, permanent: true }).id;

describe("RoomSession: кодек binary", { timeout: 20_000 }, () => {
	it("input займає 7 байт, ack і знімок приходять, форма та сама", async () => {
		const s = await joinRoom(url, {
			room: newRoom(),
			name: "Оля",
			codec: "binary",
		});
		assert.equal(s.codec, "binary");
		const t0 = s.traffic;
		assert.equal(s.sendInput({ right: true }), 1);
		const t1 = s.traffic;
		assert.equal(t1.bytesOut - t0.bytesOut, 7);
		assert.equal(t1.msgsOut - t0.msgsOut, 1);

		await waitFor(() => s.snapshot?.ack === 1, 3000);
		const snap = s.snapshot;
		assert.equal(snap.type, "snapshot");
		assert.ok(Number.isInteger(snap.tick));
		assert.equal(snap.players.length, 1);
		assert.equal(snap.ships[0].player, s.you.id);
		s.leave();
	});

	it("за замовчуванням json: input у кілька разів більший", async () => {
		const s = await joinRoom(url, { room: newRoom(), name: "Оля" });
		assert.equal(s.codec, "json");
		const t0 = s.traffic;
		s.sendInput({ right: true });
		assert.ok(s.traffic.bytesOut - t0.bytesOut > 60);
		s.leave();
	});

	it("додатковий параметр в адресі не заважає", async () => {
		const s = await joinRoom(`${url}?x=1`, {
			room: newRoom(),
			name: "Оля",
			codec: "binary",
		});
		await waitFor(() => s.snapshot !== null, 3000);
		assert.equal(s.snapshot.type, "snapshot");
		s.leave();
	});

	it("бінарні знімки помітно менші за JSON", async () => {
		async function averageBytes(codec) {
			const s = await joinRoom(url, { room: newRoom(), name: "Оля", codec });
			let n = 0;
			s.addEventListener("snapshot", () => n++);
			await waitFor(() => n >= 3, 3000);
			const b0 = s.traffic;
			const n0 = n;
			await waitFor(() => n >= n0 + 20, 3000);
			const b1 = s.traffic;
			s.leave();
			return (b1.bytesIn - b0.bytesIn) / (b1.msgsIn - b0.msgsIn);
		}
		const bin = await averageBytes("binary");
		const text = await averageBytes("json");
		console.log(
			`байт на знімок: binary ${bin.toFixed(0)}, json ${text.toFixed(0)}`,
		);
		assert.ok(bin * 2 < text, `binary ${bin}, json ${text}`);
	});
});
