import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { ConfigError, loadConfig } from "../src/config.js";

describe("loadConfig", () => {
	it("значення за замовчуванням", () => {
		const c = loadConfig({});
		assert.equal(c.port, 3000);
		assert.equal(c.host, "127.0.0.1");
		assert.ok(path.isAbsolute(c.logDir));
		assert.ok(c.clientDir.endsWith(path.join("client", "dist")));
	});

	it("читає оточення", () => {
		const c = loadConfig({ PORT: "8080", HOST: "0.0.0.0", LOG_DIR: "./x" });
		assert.equal(c.port, 8080);
		assert.equal(c.host, "0.0.0.0");
		assert.equal(c.logDir, path.resolve("./x"));
	});

	it("збирає всі помилки одразу", () => {
		assert.throws(
			() => loadConfig({ PORT: "abc", HOST: "   " }),
			(error) => error instanceof ConfigError && error.problems.length === 2,
		);
	});

	it("порт поза діапазоном відхиляється", () => {
		assert.throws(() => loadConfig({ PORT: "70000" }), ConfigError);
		assert.throws(() => loadConfig({ PORT: "-1" }), ConfigError);
		assert.throws(() => loadConfig({ PORT: "" }), ConfigError);
	});

	it("MAX_ROOMS: за замовчуванням 50, некоректне значення відхиляється", () => {
		assert.equal(loadConfig({}).maxRooms, 50);
		assert.equal(loadConfig({ MAX_ROOMS: "5" }).maxRooms, 5);
		for (const bad of ["0", "-1", "abc", "1.5", ""]) {
			assert.throws(() => loadConfig({ MAX_ROOMS: bad }), ConfigError, bad);
		}
	});

	it("ENABLE_SLOW вмикається лише значенням 1", () => {
		assert.equal(loadConfig({}).enableSlow, false);
		assert.equal(loadConfig({ ENABLE_SLOW: "true" }).enableSlow, false);
		assert.equal(loadConfig({ ENABLE_SLOW: "1" }).enableSlow, true);
	});

	it("ENABLE_NETSIM вмикається лише значенням 1", () => {
		assert.equal(loadConfig({}).enableNetsim, false);
		assert.equal(loadConfig({ ENABLE_NETSIM: "true" }).enableNetsim, false);
		assert.equal(loadConfig({ ENABLE_NETSIM: "1" }).enableNetsim, true);
	});
});
