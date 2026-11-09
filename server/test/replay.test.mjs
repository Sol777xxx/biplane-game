import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { createMatchLogs } from "../src/log/matchlog.js";
import { readEvents, replayStream } from "../src/log/replay.js";
import { silentLogger } from "../src/logger.js";
import { Room } from "../src/rooms.js";

let base;
before(async () => {
	base = await mkdtemp(path.join(tmpdir(), "biplane-replay-"));
});
after(() => rm(base, { recursive: true, force: true }));

async function file(name, text) {
	const f = path.join(base, name);
	await writeFile(f, text);
	return f;
}

async function all(iterable) {
	const out = [];
	for await (const item of iterable) out.push(item);
	return out;
}

describe("readEvents", () => {
	it("події по порядку, навіть коли шматки ріжуть рядки й символи навпіл", async () => {
		const events = [
			{ t: 1, type: "chat", text: "привіт, світе" },
			{ t: 2, type: "chat", text: "їжак, щука, ґанок" },
			{ t: 3, type: "leave" },
		];
		const f = await file(
			"a.ndjson",
			`${events.map((e) => JSON.stringify(e)).join("\n")}\n`,
		);
		// 5 байтів на шматок: кирилиця (2 байти на літеру) гарантовано розрізається
		assert.deepEqual(await all(readEvents(f, { highWaterMark: 5 })), events);
	});

	it("порожні рядки, \\r\\n і останній рядок без \\n", async () => {
		const f = await file("b.ndjson", '{"a":1}\n\n{"a":2}\r\n{"a":3}');
		assert.deepEqual(await all(readEvents(f)), [{ a: 1 }, { a: 2 }, { a: 3 }]);
	});

	it("битий рядок за замовчуванням кидає SyntaxError з номером", async () => {
		const f = await file("c.ndjson", '{"a":1}\n{oops\n{"a":3}\n');
		await assert.rejects(
			all(readEvents(f)),
			(e) => e instanceof SyntaxError && /рядок 2/.test(e.message),
		);
	});

	it("з onBadLine битий рядок пропускається й повідомляється", async () => {
		const f = await file("d.ndjson", '{"a":1}\n{oops\n{"a":3}\n');
		const bad = [];
		const events = await all(readEvents(f, { onBadLine: (n) => bad.push(n) }));
		assert.deepEqual(events, [{ a: 1 }, { a: 3 }]);
		assert.deepEqual(bad, [2]);
	});

	it("abort зупиняє читання з AbortError", async () => {
		const f = await file("e.ndjson", '{"a":1}\n');
		const ac = new AbortController();
		ac.abort();
		await assert.rejects(all(readEvents(f, { signal: ac.signal })), {
			name: "AbortError",
		});
	});

	it("читає лог, який записав matchlog (круговий тест)", async () => {
		const dir = path.join(base, "round");
		const logs = createMatchLogs({ dir, log: silentLogger });
		const room = new Room({ id: "r1", name: "R" });
		logs.attach(room);
		room.join({ id: "1", name: "Оля" });
		room.chat("1", "привіт");
		room.leave("1");
		await logs.close();

		const [name] = await readdir(dir);
		const f = path.join(dir, name);
		const types = (await all(readEvents(f))).map((e) => e.type);
		assert.deepEqual(types, [
			"match_start",
			"join",
			"chat",
			"leave",
			"match_end",
		]);
		assert.deepEqual(
			(await all(replayStream(f))).map((e) => e.type),
			types,
		);
	});
});
