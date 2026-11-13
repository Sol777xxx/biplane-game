import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { printReport, runDogfight } from "../tools/dogfight.mjs";

describe("dogfight: два боти на справжньому клієнтському коді", {
	timeout: 90_000,
}, () => {
	it("100 ± 30 мс і 2% втрат: знімки йдуть, звірка тримається в межах", async () => {
		const r = await runDogfight({ seconds: 6, warmup: 2 });
		printReport(r);
		assert.equal(r.bots.length, 2);
		for (const b of r.bots) {
			assert.ok(
				b.snapsPerSec > 20 && b.snapsPerSec < 31,
				`знімків/с ${b.snapsPerSec}`,
			);
			assert.ok(b.rtt.n >= 5, `pong ${b.rtt.n}`);
			assert.ok(b.rtt.mean > 70 && b.rtt.mean < 250, `RTT ${b.rtt.mean}`);
			assert.ok(b.corr.n > 100, `звірок ${b.corr.n}`);
			assert.ok(b.corr.mean < 15, `поправка сер. ${b.corr.mean}`);
			assert.ok(b.corr.max < 300, `поправка макс ${b.corr.max}`);
			assert.ok(b.starvedPct < 10, `голод ${b.starvedPct}%`);
		}
		assert.ok(r.server.ticks > 150, `тіків ${r.server.ticks}`);
	});

	it("без інтерполяції чужий корабель стоїть частіше, ніж з нею", async () => {
		const off = [];
		const on = [];
		for (const interp of [0, 100]) {
			const r = await runDogfight({ seconds: 6, warmup: 2, interp });
			(interp === 0 ? off : on).push(...r.bots.map((b) => b.stallPct));
		}
		const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
		console.log(
			`стоїть %: без інтерполяції ${avg(off).toFixed(1)}, зі 100 мс ${avg(on).toFixed(1)}`,
		);
		assert.ok(avg(on) < 10, `зі 100 мс стоїть ${avg(on)}%`);
		assert.ok(avg(off) > avg(on), `${avg(off)} проти ${avg(on)}`);
	});
});
