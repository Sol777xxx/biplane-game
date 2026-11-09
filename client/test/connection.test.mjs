import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { WebSocketServer } from "ws";
import { backoffDelay, Connection } from "../src/net/connection.js";
import { waitFor } from "./helpers.mjs";

const servers = [];
const conns = [];

// onConnection(ws, wss) викликається на кожне нове з'єднання
async function server(onConnection) {
	const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
	await new Promise((resolve) => wss.once("listening", resolve));
	servers.push(wss);
	const received = [];
	wss.on("connection", (ws) => {
		ws.on("message", (data) => received.push(JSON.parse(data.toString())));
		onConnection?.(ws, wss);
	});
	return { wss, received, url: `ws://127.0.0.1:${wss.address().port}` };
}

function client(url, options) {
	const c = new Connection(url, options);
	conns.push(c);
	return c;
}

after(() => {
	for (const c of conns) c.close();
	for (const w of servers) {
		for (const ws of w.clients) ws.terminate();
		w.close();
	}
});

describe("Connection", () => {
	it("черга: join з 'open' іде першим, потім накопичене в порядку відправки", async () => {
		const { received, url } = await server();
		const c = client(url);
		c.send({ n: 1 });
		c.send({ n: 2 });
		assert.equal(c.queued, 2);
		c.addEventListener("open", () => c.send({ hello: true }));
		c.connect();
		await waitFor(() => received.length === 3);
		assert.deepEqual(received, [{ hello: true }, { n: 1 }, { n: 2 }]);
	});

	it("черга обмежена: найстаріші відкидаються", async () => {
		const { received, url } = await server();
		const c = client(url, { maxQueue: 3 });
		for (let n = 1; n <= 5; n++) c.send({ n });
		assert.equal(c.queued, 3);
		c.connect();
		await waitFor(() => received.length === 3);
		assert.deepEqual(
			received.map((m) => m.n),
			[3, 4, 5],
		);
	});

	it("dispatch за type; відписка працює", async () => {
		const { url } = await server((ws) =>
			ws.on("message", () =>
				ws.send(JSON.stringify({ type: "chat", text: "hi" })),
			),
		);
		const c = client(url);
		const a = [];
		const b = [];
		const other = [];
		c.on("chat", (m) => a.push(m));
		const off = c.on("chat", (m) => b.push(m));
		c.on("roster", (m) => other.push(m));
		off();
		c.send({ go: 1 });
		c.connect();
		await waitFor(() => a.length === 1);
		await sleep(20);
		assert.equal(a[0].text, "hi");
		assert.equal(b.length, 0);
		assert.equal(other.length, 0);
	});

	it("після обриву перепідключається й далі відправляє", async () => {
		let n = 0;
		const { received, url } = await server((ws) => {
			n++;
			if (n === 1) ws.terminate();
		});
		const c = client(url, { baseMs: 10, maxMs: 20 });
		const attempts = [];
		c.addEventListener("reconnecting", (e) => attempts.push(e.detail.attempt));
		c.connect();
		await waitFor(() => n >= 2 && c.state === "open");
		assert.deepEqual(attempts, [1]);
		c.send({ after: true });
		await waitFor(() => received.some((m) => m.after));
	});

	it("фатальний код (4006) не перепідключає", async () => {
		let n = 0;
		const { url } = await server((ws) => {
			n++;
			ws.close(4006, "room full");
		});
		const c = client(url, { baseMs: 10, maxMs: 20 });
		const closes = [];
		c.addEventListener("close", (e) => closes.push(e.detail));
		c.connect();
		await waitFor(() => closes.length === 1);
		await sleep(150);
		assert.equal(closes[0].code, 4006);
		assert.equal(closes[0].willRetry, false);
		assert.equal(n, 1);
		assert.equal(c.state, "closed");
	});

	it("close() зупиняє перепідключення", async () => {
		let n = 0;
		const { url } = await server((ws) => {
			n++;
			ws.terminate();
		});
		const c = client(url, { baseMs: 20, maxMs: 20 });
		c.connect();
		await waitFor(() => n >= 2);
		c.close();
		await sleep(50); // дати завершитись спробі, що вже йшла
		const before = n;
		await sleep(150);
		assert.equal(n, before);
	});

	it("backoff зростає, обмежений зверху, jitter у межах", () => {
		const o = { baseMs: 100, maxMs: 1000 };
		for (let attempt = 1; attempt <= 8; attempt++) {
			const cap = Math.min(1000, 100 * 2 ** (attempt - 1));
			assert.equal(backoffDelay(attempt, { ...o, random: () => 0 }), cap / 2);
			assert.equal(backoffDelay(attempt, { ...o, random: () => 1 }), cap);
		}
		assert.equal(backoffDelay(20, { ...o, random: () => 1 }), 1000);
	});
});
