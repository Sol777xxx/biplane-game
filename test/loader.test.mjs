import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, it } from "node:test";
import {
	fetchJson,
	HttpError,
	isRetryable,
	loadAll,
	loadAllSequential,
	withRetry,
} from "../src/assets/loader.js";

let server;
let base;
const hits = {};

before(async () => {
	server = http.createServer((req, res) => {
		const u = new URL(req.url, "http://x");
		hits[u.pathname] = (hits[u.pathname] ?? 0) + 1;
		const delay = Number(u.searchParams.get("delay") ?? 0);
		setTimeout(() => {
			if (u.pathname === "/ok.json") return res.end('{"a":1}');
			if (u.pathname === "/bad.json") return res.end('{"a":');
			if (u.pathname === "/flaky.json") {
				// перші два запити 503, третій успішний
				if (hits[u.pathname] < 3) {
					res.statusCode = 503;
					return res.end("busy");
				}
				return res.end('{"ok":true}');
			}
			if (u.pathname === "/forbidden.json") {
				res.statusCode = 403;
				return res.end("no");
			}
			res.statusCode = 404;
			res.end("nope");
		}, delay);
	});
	await new Promise((r) => server.listen(0, r));
	base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

describe("fetchJson", () => {
	it("віддає JSON", async () => {
		assert.deepEqual(await fetchJson(`${base}/ok.json`), { a: 1 });
	});
	it("404 це відхилений проміс (HttpError), а не успіх", async () => {
		await assert.rejects(fetchJson(`${base}/none.json`), (e) => {
			assert.ok(e instanceof HttpError);
			assert.equal(e.status, 404);
			return true;
		});
	});
	it("битий JSON дає SyntaxError", async () => {
		await assert.rejects(fetchJson(`${base}/bad.json`), SyntaxError);
	});
	it("таймаут дає TimeoutError", async () => {
		await assert.rejects(
			fetchJson(`${base}/ok.json?delay=500`, { timeoutMs: 50 }),
			{ name: "TimeoutError" },
		);
	});
	it("abort дає AbortError", async () => {
		const c = new AbortController();
		const p = fetchJson(`${base}/ok.json?delay=500`, { signal: c.signal });
		setTimeout(() => c.abort(), 30);
		await assert.rejects(p, { name: "AbortError" });
	});
});

describe("withRetry", () => {
	it("повторює 5xx і зрештою успішний", async () => {
		hits["/flaky.json"] = 0;
		const delays = [];
		const v = await withRetry(() => fetchJson(`${base}/flaky.json`), {
			attempts: 4,
			baseMs: 10,
			onRetry: (r) => delays.push(r.delay),
		});
		assert.deepEqual(v, { ok: true });
		assert.equal(hits["/flaky.json"], 3);
		assert.equal(delays.length, 2);
	});
	it("не повторює 4xx", async () => {
		hits["/forbidden.json"] = 0;
		await assert.rejects(
			withRetry(() => fetchJson(`${base}/forbidden.json`), {
				attempts: 5,
				baseMs: 5,
			}),
			{ status: 403 },
		);
		assert.equal(hits["/forbidden.json"], 1);
	});
	it("backoff експоненційний, jitter обмежений зверху", async () => {
		const seen = [];
		await assert.rejects(
			withRetry(
				() => {
					throw new TypeError("network");
				},
				{
					attempts: 4,
					baseMs: 100,
					maxMs: 350,
					random: () => 1, // максимум jitter: видно верхню межу
					onRetry: (r) => seen.push(r.delay),
				},
			),
			TypeError,
		);
		assert.deepEqual(seen, [100, 200, 350]);
	});
	it("abort під час паузи зупиняє повтори", async () => {
		const c = new AbortController();
		let calls = 0;
		const p = withRetry(
			() => {
				calls++;
				throw new TypeError("network");
			},
			{ attempts: 5, baseMs: 1000, signal: c.signal, random: () => 1 },
		);
		setTimeout(() => c.abort(), 30);
		await assert.rejects(p, { name: "AbortError" });
		assert.equal(calls, 1);
	});
	it("isRetryable", () => {
		assert.equal(isRetryable(new HttpError(500, "u")), true);
		assert.equal(isRetryable(new HttpError(404, "u")), false);
		assert.equal(isRetryable(new SyntaxError("x")), false);
	});
});

describe("loadAll", () => {
	const jsonItems = (n, extra = "") =>
		Array.from({ length: n }, (_, i) => ({
			id: `j${i}`,
			type: "json",
			url: `${base}/ok.json?delay=80${extra}`,
		}));

	it("рахує прогрес по кожному файлу", async () => {
		const fractions = [];
		const { assets } = await loadAll(
			{ assets: jsonItems(4) },
			{
				onProgress: (e) => e.type === "item" && fractions.push(e.fraction),
			},
		);
		assert.deepEqual(fractions, [0.25, 0.5, 0.75, 1]);
		assert.deepEqual(assets.j0, { a: 1 });
	});
	it("concurrent помітно швидший за sequential", async () => {
		const m = { assets: jsonItems(6) };
		const c = await loadAll(m);
		const s = await loadAllSequential(m);
		assert.ok(s.ms > c.ms * 2, `seq ${s.ms} vs conc ${c.ms}`);
	});
	it("optional ассет не валить завантаження", async () => {
		const { assets, failures } = await loadAll({
			assets: [
				{ id: "a", type: "json", url: `${base}/ok.json` },
				{
					id: "b",
					type: "json",
					url: `${base}/none.json`,
					optional: true,
					fallback: { d: 1 },
				},
				{ id: "c", type: "json", url: `${base}/bad.json`, optional: true },
			],
		});
		assert.deepEqual(assets.b, { d: 1 });
		assert.equal(assets.c, null);
		assert.equal(failures.length, 2);
	});
	it("обов'язковий збій відхиляє loadAll і скасовує решту", async () => {
		const t = performance.now();
		await assert.rejects(
			loadAll({
				assets: [
					{ id: "slow", type: "json", url: `${base}/ok.json?delay=3000` },
					{ id: "dead", type: "json", url: `${base}/none.json` },
				],
			}),
			{ status: 404 },
		);
		assert.ok(performance.now() - t < 1000);
	});
	it("зовнішній abort під час завантаження", async () => {
		const c = new AbortController();
		const p = loadAll(
			{ assets: jsonItems(3, "0") }, // delay=800
			{ signal: c.signal },
		);
		setTimeout(() => c.abort(), 50);
		await assert.rejects(p, { name: "AbortError" });
	});
});