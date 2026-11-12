import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

const dir = new URL("../sim/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".js"));

describe("shared/sim чистий", () => {
	it("кожен модуль імпортується в Node без DOM", async () => {
		assert.equal(typeof document, "undefined");
		assert.equal(typeof window, "undefined");
		for (const file of files) {
			await import(new URL(file, dir));
		}
	});

	it("немає імпортів node:* і звернень до DOM", () => {
		for (const file of files) {
			const src = readFileSync(new URL(file, dir), "utf8");
			assert.doesNotMatch(src, /from\s+["']node:/, file);
			assert.doesNotMatch(
				src,
				/\b(document|window|localStorage|requestAnimationFrame|navigator)\b/,
				file,
			);
		}
	});
});
