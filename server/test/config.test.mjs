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
});
