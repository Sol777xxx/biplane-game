import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, it } from "vitest";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { silentLogger } from "../src/logger.ts";
import { RoomManager } from "../src/rooms.ts";

const apps = [];
afterAll(() => Promise.all(apps.map((a) => a.close())));

describe("статика для PWA", () => {
	it("manifest віддається зі своїм MIME, sw.js не кешується, решта кешується", async () => {
		const dir = mkdtempSync(join(tmpdir(), "biplane-static-"));
		writeFileSync(join(dir, "manifest.webmanifest"), "{}");
		writeFileSync(join(dir, "sw.js"), "// sw");
		writeFileSync(join(dir, "app.js"), "// app");

		const config = {
			...loadConfig({ CLIENT_DIR: dir }),
			port: 0,
			logDir: tmpdir(),
		};
		const app = createApp(config, {
			rooms: new RoomManager(),
			log: silentLogger,
			matchLog: false,
		});
		apps.push(app);
		const { port } = await app.listen();
		const http = `http://127.0.0.1:${port}`;

		const manifest = await fetch(`${http}/manifest.webmanifest`);
		assert.equal(manifest.status, 200);
		assert.match(
			manifest.headers.get("content-type") ?? "",
			/^application\/manifest\+json/,
		);
		const sw = await fetch(`${http}/sw.js`);
		assert.equal(sw.headers.get("cache-control"), "no-cache");
		const app1 = await fetch(`${http}/app.js`);
		assert.match(app1.headers.get("cache-control") ?? "", /max-age/);
	});
});
