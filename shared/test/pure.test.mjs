import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

// усе, що імпортують і клієнт, і сервер, має бути чистим
const DIRS = ["sim", "protocol", "codec"].map(
	(d) => new URL(`../${d}/`, import.meta.url),
);
const files = DIRS.flatMap((dir) =>
	readdirSync(dir)
		.filter((f) => f.endsWith(".js") || f.endsWith(".ts"))
		.map((f) => new URL(f, dir)),
);

describe("shared чистий", () => {
	it("кожен модуль імпортується в Node без DOM", async () => {
		assert.equal(typeof document, "undefined");
		assert.equal(typeof window, "undefined");
		for (const file of files) {
			await import(file);
		}
	});

	it("немає імпортів node:* і звернень до DOM", () => {
		for (const file of files) {
			const src = readFileSync(file, "utf8");
			assert.doesNotMatch(src, /from\s+["']node:/, file.pathname);
			assert.doesNotMatch(
				src,
				/\b(document|window|localStorage|requestAnimationFrame|navigator)\b/,
				file.pathname,
			);
		}
	});

	it("немає джерел недетермінізму: Math.random, Date.now, performance", () => {
		for (const file of files) {
			const src = readFileSync(file, "utf8");
			assert.doesNotMatch(src, /Math\.random/, file.pathname);
			assert.doesNotMatch(src, /Date\.now|new Date/, file.pathname);
			assert.doesNotMatch(src, /\bperformance\b/, file.pathname);
		}
	});
});
