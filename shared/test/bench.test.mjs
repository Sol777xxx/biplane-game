import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { binary } from "../codec/binary.js";
import { json } from "../codec/json.js";
import { TICK_RATE } from "../sim/time.ts";
import {
	averageCounts,
	collectInputs,
	collectSnapshots,
	measureSizes,
	measureTime,
	parseArgs,
	runBench,
	toMarkdown,
} from "../tools/bench-codec.mjs";

const SMALL = { players: 2, ticks: 90, warmup: 30, seed: 1 };
const FAST = { rounds: 2, passes: 5 };
const encoder = new TextEncoder();

describe("bench: дані", () => {
	it("знімки: кількість, послідовні тіки, ack = tick, відтворюваність", () => {
		const a = collectSnapshots(SMALL);
		assert.equal(a.length, 90);
		assert.equal(a[0].tick, 31);
		assert.equal(a.at(-1).tick, 120);
		for (const m of a) {
			assert.equal(m.type, "snapshot");
			assert.equal(m.ack, m.tick);
			assert.equal(m.players.length, 2);
		}
		assert.deepEqual(collectSnapshots(SMALL), a);
		assert.notDeepEqual(collectSnapshots({ ...SMALL, seed: 2 }), a);
	});

	it("input: seq з 1, усі клавіші булеві", () => {
		const inputs = collectInputs(50);
		assert.equal(inputs.length, 50);
		assert.equal(inputs[0].seq, 1);
		assert.equal(inputs[49].seq, 50);
		assert.equal(typeof inputs[0].keys.fire, "boolean");
	});

	it("середні кількості сутностей", () => {
		const c = averageCounts(collectSnapshots(SMALL));
		assert.ok(c.ships > 0 && c.ships <= 2);
		assert.ok(c.obstacles >= 3 && c.obstacles <= 6, `хмарок ${c.obstacles}`);
		assert.ok(c.bullets >= 0 && c.events >= 0);
	});
});

describe("bench: розміри", () => {
	const snapshots = collectSnapshots(SMALL);
	const inputs = collectInputs(90);
	const sizes = measureSizes(snapshots, inputs);

	it("збігаються з реальним кодуванням", () => {
		const bin =
			snapshots.reduce((n, m) => n + binary.encodeSnapshot(m).byteLength, 0) /
			snapshots.length;
		const text =
			snapshots.reduce(
				(n, m) => n + encoder.encode(JSON.stringify(m)).length,
				0,
			) / snapshots.length;
		assert.equal(sizes.binary.snapshot.mean, bin);
		assert.equal(sizes.json.snapshot.mean, text);
		assert.ok(
			sizes.binary.snapshot.min <= bin && bin <= sizes.binary.snapshot.max,
		);
	});

	it("KB/s це байти × частота / 1024", () => {
		for (const k of ["json", "binary"]) {
			assert.equal(
				sizes[k].downKBs,
				(sizes[k].snapshot.mean * TICK_RATE) / 1024,
			);
			assert.equal(sizes[k].upKBs, (sizes[k].input.mean * TICK_RATE) / 1024);
		}
	});

	it("binary: input рівно 7 байт, знімок і input менші за JSON", () => {
		assert.equal(sizes.binary.input.min, 7);
		assert.equal(sizes.binary.input.max, 7);
		assert.ok(sizes.json.input.mean > 60);
		assert.ok(sizes.json.snapshot.mean > sizes.binary.snapshot.mean * 2);
	});

	it("відтворюваність: той самий seq дає ті самі розміри", () => {
		const again = measureSizes(collectSnapshots(SMALL), inputs);
		assert.deepEqual(again, sizes);
	});
});

describe("bench: час", () => {
	it("усі виміри скінченні й додатні", () => {
		const snapshots = collectSnapshots(SMALL);
		const inputs = collectInputs(90);
		for (const codec of [json, binary]) {
			const t = measureTime(codec, snapshots, inputs, FAST);
			for (const part of [t.snapshot, t.input]) {
				for (const v of [part.encode, part.decode, part.both]) {
					assert.ok(Number.isFinite(v) && v > 0, `${codec.name}: ${v}`);
				}
			}
		}
	});
});

describe("bench: звіт", () => {
	const r = runBench({ ...SMALL, ...FAST });
	const md = toMarkdown(r);

	it("runBench: форма результату", () => {
		assert.equal(r.options.players, 2);
		assert.equal(typeof r.env.node, "string");
		assert.ok(r.sizes.json && r.sizes.binary);
		assert.ok(Number.isFinite(r.times.binary.snapshot.both));
	});

	it("markdown: заголовок таблиці з методички й обидва рядки", () => {
		assert.ok(
			md.includes(
				"| Codec | Bytes/snapshot | KB/s per client (down) | KB/s per client (up) | Encode+decode µs |",
			),
		);
		assert.ok(md.includes("| JSON |"));
		assert.ok(md.includes("| Binary (`DataView`) |"));
		assert.ok(md.includes("Примітки:"));
	});

	it("некоректні параметри це RangeError", () => {
		for (const bad of [
			{ players: 0 },
			{ players: 9 },
			{ ticks: 1.5 },
			{ rounds: 0 },
			{ warmup: -1 },
		]) {
			assert.throws(() => runBench(bad), RangeError, JSON.stringify(bad));
		}
	});
});

describe("bench: аргументи", () => {
	it("числа й --out", () => {
		assert.deepEqual(
			parseArgs(["--players", "2", "--ticks", "300", "--out", "x.md"]),
			{ players: 2, ticks: 300, out: "x.md" },
		);
	});

	it("невідомий ключ, не число, ключ з прототипа", () => {
		for (const argv of [
			["--nope", "1"],
			["--players", "abc"],
			["--toString", "1"],
			["--players"],
		]) {
			assert.throws(() => parseArgs(argv), Error, argv.join(" "));
		}
	});
});
