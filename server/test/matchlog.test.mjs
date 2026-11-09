import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { after, before, describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { createMatchLogs, NdjsonTransform } from "../src/log/matchlog.js";
import { silentLogger } from "../src/logger.js";
import { Room } from "../src/rooms.js";

let base;
before(async () => {
	base = await mkdtemp(path.join(tmpdir(), "biplane-log-"));
});
after(() => rm(base, { recursive: true, force: true }));

async function readEvents(file) {
	const text = await readFile(file, "utf8");
	return text
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
}

async function transform(events) {
	const t = new NdjsonTransform();
	let out = "";
	await pipeline(Readable.from(events), t, async (source) => {
		for await (const chunk of source) out += chunk.toString();
	});
	return { out, count: t.count };
}

describe("NdjsonTransform", () => {
	it("кожна подія це один рядок JSON", async () => {
		const { out, count } = await transform([
			{ t: 1, type: "a" },
			{ t: 2, type: "b" },
		]);
		assert.equal(out, '{"t":1,"type":"a"}\n{"t":2,"type":"b"}\n');
		assert.equal(count, 2);
	});

	it("подія з циклом не обриває потік", async () => {
		const bad = { t: 1, type: "x" };
		bad.self = bad;
		const { out } = await transform([bad, { t: 2, type: "ok" }]);
		const lines = out
			.trim()
			.split("\n")
			.map((l) => JSON.parse(l));
		assert.equal(lines.length, 2);
		assert.equal(lines[0].type, "log_error");
		assert.equal(lines[1].type, "ok");
	});
});

describe("createMatchLogs", () => {
	it("пише матч у файл від match_start до match_end й знімає слухача", async () => {
		const dir = path.join(base, "a");
		const logs = createMatchLogs({ dir, log: silentLogger });
		const room = new Room({ id: "r1", name: "R" });
		logs.attach(room);

		room.join({ id: "1", name: "A" });
		room.chat("1", "hi");
		room.leave("1");
		await logs.close();

		const files = await readdir(dir);
		assert.equal(files.length, 1);
		assert.match(
			files[0],
			/^r1-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.ndjson$/,
		);
		const events = await readEvents(path.join(dir, files[0]));
		assert.deepEqual(
			events.map((e) => e.type),
			["match_start", "join", "chat", "leave", "match_end"],
		);
		assert.equal(room.listenerCount("event"), 0);
		assert.equal(logs.active, 0);
	});

	it("кожен матч у своєму файлі", async () => {
		const dir = path.join(base, "b");
		const logs = createMatchLogs({ dir, log: silentLogger });
		const room = new Room({ id: "r2", name: "R" });
		logs.attach(room);

		room.join({ id: "1", name: "A" });
		room.leave("1");
		await sleep(10); // різні мілісекунди в імені файлу
		room.join({ id: "2", name: "B" });
		room.leave("2");
		await logs.close();

		const files = await readdir(dir);
		assert.equal(files.length, 2);
		for (const f of files) {
			const events = await readEvents(path.join(dir, f));
			assert.equal(events[0].type, "match_start");
			assert.equal(events.at(-1).type, "match_end");
		}
	});

	it("close() дописує матч, який ще йде (shutdown)", async () => {
		const dir = path.join(base, "c");
		const logs = createMatchLogs({ dir, log: silentLogger });
		const room = new Room({ id: "r3", name: "R" });
		logs.attach(room);

		room.join({ id: "1", name: "A" });
		room.chat("1", "ще грає");
		await logs.close(); // гравець не виходив

		const [file] = await readdir(dir);
		const events = await readEvents(path.join(dir, file));
		assert.deepEqual(
			events.map((e) => e.type),
			["match_start", "join", "chat"],
		);
		assert.equal(room.listenerCount("event"), 0);
	});

	it("збій диска логується, а гра триває", async () => {
		const blocker = path.join(base, "blocker");
		await writeFile(blocker, "це файл, а не тека");
		const errors = [];
		const log = { ...silentLogger, error: (...args) => errors.push(args) };
		const logs = createMatchLogs({ dir: path.join(blocker, "sub"), log });
		const room = new Room({ id: "r4", name: "R" });
		logs.attach(room);

		room.join({ id: "1", name: "A" });
		room.chat("1", "hi");
		room.leave("1");
		await logs.close();

		assert.equal(errors.length, 1);
		assert.equal(room.players.size, 0);
		assert.equal(room.listenerCount("event"), 0); // черга більше не росте
		assert.equal(logs.active, 0);
	});
});
