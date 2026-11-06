import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHud } from "../src/hud.js";

// ctx-заглушка: запам'ятовує виклики методів, присвоєння властивостей ігнорує
function fakeCtx() {
	const calls = [];
	return new Proxy(
		{},
		{
			get: (_t, name) =>
				name === "calls" ? calls : (...args) => calls.push([name, ...args]),
			set: () => true,
		},
	);
}

function scored(bus, delta, at = { x: 100, y: 200 }) {
	bus.dispatchEvent(
		new CustomEvent("scored", { detail: { delta, total: delta, at } }),
	);
}

describe("hud", () => {
	it("scored додає попап, який малює +N", () => {
		const bus = new EventTarget();
		const hud = createHud(bus);
		scored(bus, 45);
		assert.equal(hud.count, 1);
		const ctx = fakeCtx();
		hud.draw(ctx, performance.now());
		assert.ok(ctx.calls.some(([m, t]) => m === "fillText" && t === "+45"));
	});

	it("попап зникає з часом", () => {
		const bus = new EventTarget();
		const hud = createHud(bus);
		scored(bus, 70);
		hud.draw(fakeCtx(), performance.now() + 5000);
		assert.equal(hud.count, 0);
	});

	it("dispose відписує від шини", () => {
		const bus = new EventTarget();
		const hud = createHud(bus);
		hud.dispose();
		scored(bus, 45);
		assert.equal(hud.count, 0);
	});
});
