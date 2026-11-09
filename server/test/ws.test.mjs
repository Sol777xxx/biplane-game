import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { after, describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import WebSocket from "ws";
import { createApp } from "../src/app.js";
import { silentLogger } from "../src/logger.js";
import { CLOSE } from "../src/protocol.js";
import { RoomManager } from "../src/rooms.js";

const apps = [];

async function start(wsOptions = {}) {
	const rooms = new RoomManager();
	const config = {
		port: 0,
		host: "127.0.0.1",
		clientDir: tmpdir(),
		logDir: tmpdir(),
	};
	const app = createApp(config, {
		rooms,
		log: silentLogger,
		ws: wsOptions,
		matchLog: false,
	});
	const { port } = await app.listen();
	apps.push(app);
	return { app, rooms, port, url: `ws://127.0.0.1:${port}/ws` };
}
after(() => Promise.all(apps.map((a) => a.close())));

const within = (promise, ms = 1500) =>
	Promise.race([
		promise,
		sleep(ms, undefined, { ref: false }).then(() => {
			throw new Error(`не дочекались за ${ms} мс`);
		}),
	]);

function connect(url, options) {
	const ws = new WebSocket(url, options);
	const inbox = [];
	const waiters = [];
	ws.on("message", (data) => {
		const m = JSON.parse(data.toString());
		const i = waiters.findIndex((w) => w.type === m.type);
		if (i >= 0) waiters.splice(i, 1)[0].resolve(m);
		else inbox.push(m);
	});
	ws.on("error", () => {});
	const closed = new Promise((resolve) =>
		ws.on("close", (code, reason) =>
			resolve({ code, reason: reason.toString() }),
		),
	);
	const opened = new Promise((resolve) => ws.once("open", resolve));
	return {
		ws,
		closed,
		opened,
		send: (m) =>
			ws.send(
				typeof m === "string" || Buffer.isBuffer(m) ? m : JSON.stringify(m),
			),
		next(type) {
			const i = inbox.findIndex((m) => m.type === type);
			if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
			return within(new Promise((resolve) => waiters.push({ type, resolve })));
		},
	};
}

const join = (room, name) => ({ v: 1, type: "join", room, name });

async function joined(url, room, name, options) {
	const c = connect(url, options);
	await c.opened;
	c.send(join(room, name));
	await c.next("joined");
	return c;
}

describe("WebSocket", () => {
	it("join відповідає joined з кімнатою й roster", async () => {
		const { rooms, url } = await start();
		const room = rooms.create({ name: "А" });
		const c = connect(url);
		await c.opened;
		c.send(join(room.id, "Настя"));
		const m = await c.next("joined");
		assert.equal(m.v, 1);
		assert.equal(m.you.name, "Настя");
		assert.equal(m.room.id, room.id);
		assert.deepEqual(
			m.players.map((p) => p.name),
			["Настя"],
		);
		c.ws.close();
	});

	it("двоє бачать roster одне одного й чат", async () => {
		const { rooms, url } = await start();
		const room = rooms.create({ name: "А" });
		const a = await joined(url, room.id, "Настя");
		const b = connect(url);
		await b.opened;
		b.send(join(room.id, "Анастасія"));
		const bJoined = await b.next("joined");
		assert.equal(bJoined.players.length, 2);
		assert.equal((await a.next("roster")).players.length, 2);

		a.send({ v: 1, type: "chat", text: "привіт" });
		const fromA = await a.next("chat"); // відправник теж отримує своє
		const atB = await b.next("chat");
		assert.equal(fromA.text, "привіт");
		assert.equal(atB.text, "привіт");
		assert.equal(atB.name, "Настя");
		a.ws.close();
		b.ws.close();
	});

	it("вихід оновлює roster, а порожня кімната зникає", async () => {
		const { rooms, url } = await start();
		const room = rooms.create({ name: "А" });
		const a = await joined(url, room.id, "Настя");
		const b = await joined(url, room.id, "Анастасія");
		assert.equal((await a.next("roster")).players.length, 2);

		b.ws.close();
		assert.deepEqual(
			(await a.next("roster")).players.map((p) => p.name),
			["Настя"],
		);

		a.ws.close();
		await sleep(50);
		assert.equal(rooms.get(room.id), undefined);
	});

	it("невідома кімната: 4005", async () => {
		const { url } = await start();
		const c = connect(url);
		await c.opened;
		c.send(join("nope", "Настя"));
		assert.equal((await within(c.closed)).code, CLOSE.ROOM_NOT_FOUND);
	});

	it("повна кімната 4006, зайняте ім'я 4007", async () => {
		const { rooms, url } = await start();
		const one = rooms.create({ name: "one", max: 1 });
		const a = await joined(url, one.id, "Настя");
		const b = connect(url);
		await b.opened;
		b.send(join(one.id, "Анастасія"));
		assert.equal((await within(b.closed)).code, CLOSE.ROOM_FULL);
		a.ws.close();

		const two = rooms.create({ name: "two", max: 2 });
		const c = await joined(url, two.id, "Настя");
		const d = connect(url);
		await d.opened;
		d.send(join(two.id, "настя"));
		assert.equal((await within(d.closed)).code, CLOSE.NAME_TAKEN);
		c.ws.close();
	});

	it("порушення протоколу закривають сокет із кодом", async () => {
		const { rooms, url } = await start();
		const room = rooms.create({ name: "А" });
		const cases = [
			["не JSON", "{oops", CLOSE.BAD_FORMAT],
			["невідомий type", { v: 1, type: "dance" }, CLOSE.UNKNOWN_TYPE],
			[
				"чужа версія",
				{ v: 2, type: "join", room: room.id, name: "A" },
				CLOSE.BAD_FORMAT,
			],
			["зайве поле", { ...join(room.id, "A"), admin: true }, CLOSE.BAD_FORMAT],
			["чат до join", { v: 1, type: "chat", text: "hi" }, CLOSE.NOT_JOINED],
			["бінарний кадр", Buffer.from([1, 2, 3]), CLOSE.UNSUPPORTED],
		];
		for (const [label, message, code] of cases) {
			const c = connect(url);
			await c.opened;
			c.send(message);
			assert.equal((await within(c.closed)).code, code, label);
		}

		const twice = await joined(url, room.id, "Настя");
		twice.send(join(room.id, "Настя"));
		assert.equal((await within(twice.closed)).code, CLOSE.ALREADY_JOINED);
	});

	it("завелике повідомлення: 1009, сервер живий", async () => {
		const { port, url } = await start();
		const c = connect(url);
		await c.opened;
		c.send("x".repeat(3000)); // maxPayload 2048
		assert.equal((await within(c.closed)).code, CLOSE.TOO_BIG);
		const r = await fetch(`http://127.0.0.1:${port}/health`);
		assert.equal(r.status, 200);
	});

	it("без join за таймаут: 4002", async () => {
		const { url } = await start({ joinTimeoutMs: 100 });
		const c = connect(url);
		await c.opened;
		assert.equal((await within(c.closed)).code, CLOSE.JOIN_TIMEOUT);
	});

	it("клієнт, що не відповідає на ping, розривається", async () => {
		const { rooms, url } = await start({
			pingIntervalMs: 30,
			maxMissedPongs: 2,
		});
		const room = rooms.create({ name: "А" });
		const c = await joined(url, room.id, "Настя", { autoPong: false });
		const { code } = await within(c.closed);
		assert.equal(code, 1006); // розірвано без close-кадру
	});

	it("клієнт, що відповідає на ping, живе", async () => {
		const { rooms, url } = await start({
			pingIntervalMs: 30,
			maxMissedPongs: 2,
		});
		const room = rooms.create({ name: "А" });
		const c = await joined(url, room.id, "Настя");
		await sleep(300); // ~10 ping
		assert.equal(c.ws.readyState, WebSocket.OPEN);
		c.ws.close();
	});

	it("graceful shutdown закриває сокети кодом 1001", async () => {
		const { app, rooms, url } = await start();
		const room = rooms.create({ name: "А" });
		const c = await joined(url, room.id, "Настя");
		await app.close();
		assert.equal((await within(c.closed)).code, CLOSE.GOING_AWAY);
	});

	// підміняє bufferedAmount серверного сокета, щоб не накопичувати мегабайти по-справжньому
	async function pair(wsOptions) {
		const ctx = await start(wsOptions);
		const room = ctx.rooms.create({ name: "А" });
		const a = await joined(ctx.url, room.id, "Настя");
		const b = await joined(ctx.url, room.id, "Анастасія");
		await a.next("roster");
		const slow = { bytes: 0 };
		const server = [...ctx.app.sockets.wss.clients].find(
			(c) => c.session.player?.name === "Анастасія",
		);
		Object.defineProperty(server, "bufferedAmount", {
			configurable: true,
			get: () => slow.bytes,
		});
		return { ...ctx, room, a, b, slow };
	}

	const chat = (text) => ({ v: 1, type: "chat", text });

	describe("WebSocket: захист від зловживань", () => {
		it("rate limit: після вичерпання токенів 4008, гравець виходить із кімнати", async () => {
			const { rooms, url } = await start({
				rateCapacity: 3,
				rateRefillPerSec: 0.01,
			});
			const room = rooms.create({ name: "А" });
			const c = connect(url);
			await c.opened;
			c.send(join(room.id, "Настя")); // токен 1
			await c.next("joined");
			for (let i = 0; i < 5; i++) c.send(chat(`m${i}`)); // токени 2 і 3, далі відмова
			assert.equal((await within(c.closed)).code, CLOSE.RATE_LIMIT);
			await sleep(50);
			assert.equal(rooms.get(room.id), undefined); // detach спрацював
		});

		it("вище м'якого порогу chat відкидається, але roster доходить", async () => {
			const { url, room, a, b, slow } = await pair({
				softBufferBytes: 100,
				hardBufferBytes: 1000,
			});
			slow.bytes = 500; // між порогами
			await joined(url, room.id, "Asta");
			assert.equal((await b.next("roster")).players.length, 3);

			a.send(chat("втрачене"));
			await a.next("chat"); // відправник своє отримує
			slow.bytes = 0;
			a.send(chat("дійде"));
			// "втрачене" не надсилалось: перше chat, яке бачить Тарас, це "дійде"
			assert.equal((await b.next("chat")).text, "дійде");
		});

		it("вище жорсткого порогу з'єднання закривається з 4009", async () => {
			const { a, b, slow } = await pair({
				softBufferBytes: 100,
				hardBufferBytes: 1000,
			});
			slow.bytes = 5000;
			a.send(chat("x"));
			assert.equal((await within(b.closed)).code, CLOSE.SLOW_CLIENT);
		});
	});
});
