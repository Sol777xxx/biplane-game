// Сесія вимірювання клієнта (лаб 7, M3): сервер із N ботами, що стріляють без упину, один живий
// гравець у Chromium, 30 с із трасуванням GC, потім 30 с із профілями CPU й купи.
//
//   npm run build
//   node perf/session.mjs --label before
//   node perf/session.mjs --label after
//
// Результат у docs/perf/: <label>.json, <label>.md (таблиця для README), <label>.cpuprofile
// (DevTools → Performance → Load profile → flame chart) і <label>.heapprofile.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import { gcStats, selfTime, toMarkdown, topAllocators } from "./analyze.mjs";
import { profile, traceGc } from "./cdp.mjs";

const { values: args } = parseArgs({
	options: {
		label: { type: "string", default: "run" },
		seconds: { type: "string", default: "30" },
		bots: { type: "string", default: "8" },
		port: { type: "string", default: "4180" },
		url: { type: "string" }, // уже запущений сервер замість власного
		marks: { type: "boolean", default: false }, // ?perf=marks
		headed: { type: "boolean", default: false },
	},
});
const SECONDS = Number(args.seconds);
const BOTS = Number(args.bots);
const BASE = args.url ?? `http://127.0.0.1:${args.port}`;
const OUT = "docs/perf";

async function api(path, method = "GET", body) {
	const res = await fetch(`${BASE}${path}`, {
		method,
		headers: { "content-type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	if (!res.ok)
		throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
	return res.json();
}

async function startServer() {
	if (args.url) return null;
	const child = spawn(process.execPath, ["server/src/index.ts"], {
		env: {
			...process.env,
			PORT: args.port,
			HOST: "127.0.0.1",
			LOG_DIR: mkdtempSync(join(tmpdir(), "biplane-perf-")),
		},
		stdio: ["ignore", "inherit", "inherit"],
	});
	for (let i = 0; i < 100; i++) {
		try {
			await api("/api/rooms");
			return child;
		} catch {
			await sleep(100);
		}
	}
	child.kill();
	throw new Error("сервер не піднявся (чи зібрано клієнт: npm run build?)");
}

const ARROWS = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"];

// Тримає вогонь і крутить корабель по колу: максимум куль і рухів на екрані.
async function drive(page, seconds) {
	await page.keyboard.down("Space");
	const end = Date.now() + seconds * 1000;
	let held = null;
	for (let i = 0; Date.now() < end; i++) {
		if (held) await page.keyboard.up(held);
		held = ARROWS[i % ARROWS.length];
		await page.keyboard.down(held);
		await sleep(700);
	}
	if (held) await page.keyboard.up(held);
	await page.keyboard.up("Space");
}

const serverStats = async (roomId) => {
	const s = await api("/api/stats");
	const room = s.rooms.find((r) => r.id === roomId);
	return {
		tickMs: room?.tickMs ?? null,
		eventLoop: s.eventLoop,
		memory: s.memory,
	};
};

async function main() {
	const server = await startServer();
	const browser = await chromium.launch({ headless: !args.headed });
	try {
		const { room } = await api("/api/rooms", "POST", {
			name: "perf",
			max: 16,
			preset: "storm",
		});
		const added = await api(`/api/rooms/${room.id}/bots`, "POST", {
			count: BOTS,
			spray: true,
		});
		console.log(`кімната ${room.id}, ботів: ${added.bots}`);

		const context = await browser.newContext({
			viewport: { width: 1280, height: 720 },
			deviceScaleFactor: 1,
		});
		const page = await context.newPage();
		page.on("pageerror", (e) => console.error("pageerror:", e.message));
		await page.goto(`${BASE}/?perf${args.marks ? "=marks" : ""}`);
		await page.locator("#lobby input[type=text]").fill("Perf");
		await page.locator(`#lobby input[name=room][value="${room.id}"]`).check();
		await page.locator("#lobby button.join").click();
		await page.locator("#chat").waitFor({ state: "visible", timeout: 20_000 });
		await page.waitForFunction(() => Reflect.get(window, "perfStats"), null, {
			timeout: 5000,
		});

		console.log("розігрів 3 с…");
		await drive(page, 3);
		await page.evaluate(() => Reflect.get(window, "perfStats").reset());

		console.log(`фаза 1: ${SECONDS} с, трасування GC…`);
		const { events } = await traceGc(browser, page, () => drive(page, SECONDS));
		const perf = await page.evaluate(() =>
			Reflect.get(window, "perfStats").dump(),
		);
		const server = await serverStats(room.id);

		await page.evaluate(() => Reflect.get(window, "perfStats").reset());
		console.log(`фаза 2: ${SECONDS} с, профілі CPU й купи…`);
		const { cpu, heap } = await profile(page, () => drive(page, SECONDS));
		const perfProfiled = await page.evaluate(() =>
			Reflect.get(window, "perfStats").dump(),
		);

		const summary = {
			label: args.label,
			when: new Date().toISOString(),
			env: {
				chrome: browser.version(),
				node: process.version,
				cpu: cpus()[0]?.model,
				cores: cpus().length,
				bots: BOTS,
				seconds: SECONDS,
				marks: args.marks,
			},
			perf,
			perfProfiled,
			gc: gcStats(events),
			cpu: (({ rows, ...rest }) => ({ ...rest, rows: rows.slice(0, 15) }))(
				selfTime(cpu),
			),
			heap: (({ rows, ...rest }) => ({ ...rest, rows: rows.slice(0, 15) }))(
				topAllocators(heap),
			),
			server,
		};

		mkdirSync(OUT, { recursive: true });
		const base = join(OUT, args.label);
		writeFileSync(`${base}.json`, `${JSON.stringify(summary, null, "\t")}\n`);
		writeFileSync(`${base}.md`, toMarkdown(args.label, summary));
		writeFileSync(`${base}.cpuprofile`, JSON.stringify(cpu));
		writeFileSync(`${base}.heapprofile`, JSON.stringify(heap));
		await page.screenshot({ path: `${base}.png` });
		console.log(
			`\n${toMarkdown(args.label, summary)}\nзбережено: ${base}.{json,md,cpuprofile,heapprofile,png}`,
		);
	} finally {
		await browser.close();
		server?.kill();
	}
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
