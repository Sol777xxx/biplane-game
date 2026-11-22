// Перевіряє образ Docker за вимогами лаби 8 і виводить таблицю ✔/✖:
//   розмір < 200 МБ, процес не від root, у фіналі немає dev-залежностей,
//   HEALTHCHECK стає healthy, /health віддає git SHA збірки, wss-рукостискання з чужим Origin
//   відхиляється, docker stop < 10 с із кодом виходу 0 (клієнт отримує shutdown і 1001),
//   усі рядки логу це JSON.
//
//   node scripts/verify-docker.mjs            (потрібен запущений Docker)
import { spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import WebSocket from "ws";

const { values: args } = parseArgs({
	options: {
		tag: { type: "string", default: "biplane-game:verify" },
		port: { type: "string", default: "3999" },
		"no-build": { type: "boolean", default: false },
	},
});
const IMAGE = args.tag;
const PORT = args.port;
const NAME = "biplane-verify";
const ORIGIN = `http://127.0.0.1:${PORT}`;
const MAX_BYTES = 200 * 1000 * 1000; // «МБ» як у docker images (десяткові)

const checks = [];
const check = (name, ok, detail = "") => {
	checks.push({ name, ok, detail });
	console.log(`${ok ? "✔" : "✖"} ${name}${detail ? `: ${detail}` : ""}`);
};
const docker = (...a) => spawnSync("docker", a, { encoding: "utf8" });
const out = (r) => (r.stdout ?? "").trim();

function cleanup() {
	docker("rm", "-f", NAME);
}

if (docker("version", "--format", "{{.Server.Version}}").status !== 0) {
	console.error("Docker недоступний: запустіть Docker Desktop / демон.");
	process.exit(2);
}
cleanup();

// 1. збірка
const sha =
	out(spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" })) ||
	"verify";
if (!args["no-build"]) {
	console.log(`збираю ${IMAGE} (GIT_SHA=${sha})…`);
	const build = spawnSync(
		"docker",
		["build", "-t", IMAGE, "--build-arg", `GIT_SHA=${sha}`, "."],
		{ stdio: "inherit" },
	);
	if (build.status !== 0) {
		console.error("docker build завершився помилкою");
		process.exit(1);
	}
}

// 2. розмір, користувач, залежності
const size = Number(out(docker("image", "inspect", "-f", "{{.Size}}", IMAGE)));
check(
	"розмір образу < 200 МБ",
	size < MAX_BYTES,
	`${(size / 1e6).toFixed(1)} МБ`,
);

const uid = out(docker("run", "--rm", "--entrypoint", "id", IMAGE, "-u"));
check("процес не від root", uid !== "" && uid !== "0", `uid ${uid}`);

const dev = docker(
	"run",
	"--rm",
	"--entrypoint",
	"sh",
	IMAGE,
	"-c",
	"ls node_modules node_modules/@* 2>/dev/null | grep -Ex 'vite|vitest|typescript|playwright|@playwright|@biomejs|fast-check' || true",
);
check("у фінальному образі немає dev-залежностей", out(dev) === "", out(dev));

const cmd = out(
	docker("image", "inspect", "-f", "{{json .Config.Cmd}}", IMAGE),
);
check(
	"команда запуску: node і файл, не npm",
	cmd === '["node","server/src/index.ts"]',
	cmd,
);

const hc = out(
	docker("image", "inspect", "-f", "{{json .Config.Healthcheck}}", IMAGE),
);
check("є HEALTHCHECK", hc !== "null" && hc.includes("/health"));

// 3. запуск
const run = docker(
	"run",
	"-d",
	"--name",
	NAME,
	"-p",
	`${PORT}:3000`,
	"-e",
	`ALLOWED_ORIGINS=${ORIGIN}`,
	IMAGE,
);
if (run.status !== 0) {
	console.error(run.stderr);
	process.exit(1);
}

let health = null;
for (let i = 0; i < 60 && !health; i++) {
	try {
		const res = await fetch(`${ORIGIN}/health`, {
			signal: AbortSignal.timeout(2000),
		});
		if (res.ok) health = await res.json();
	} catch {}
	if (!health) await sleep(500);
}
check("/health відповідає", health !== null);
check("/health показує git SHA збірки", health?.sha === sha, `${health?.sha}`);

let status = "";
for (let i = 0; i < 40 && status !== "healthy"; i++) {
	status = out(docker("inspect", "-f", "{{.State.Health.Status}}", NAME));
	if (status !== "healthy") await sleep(1000);
}
check("HEALTHCHECK у стані healthy", status === "healthy", status);

const ready = await fetch(`${ORIGIN}/ready`)
	.then((r) => r.status)
	.catch(() => 0);
check("/ready відповідає 200", ready === 200, String(ready));

// 4. wss-рукостискання: чужий Origin відхиляється, свій приймається
const foreign = await new Promise((resolve) => {
	const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, {
		headers: { Origin: "https://evil.example" },
	});
	ws.once("unexpected-response", (_req, res) => resolve(res.statusCode));
	ws.once("open", () => resolve(101));
	ws.once("error", () => resolve(0));
});
check("чужий Origin: 403", foreign === 403, String(foreign));

// 5. docker stop із гравцем у кімнаті
const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, {
	headers: { Origin: ORIGIN },
});
const types = new Set();
ws.on("message", (d) => types.add(JSON.parse(d.toString()).type));
const closeCode = new Promise((resolve) =>
	ws.once("close", (code) => resolve(code)),
);
await new Promise((resolve, reject) => {
	ws.once("open", resolve);
	ws.once("error", reject);
}).catch(() => {});
ws.send(JSON.stringify({ v: 1, type: "join", room: "calm", name: "verify" }));
for (let i = 0; i < 50 && !types.has("joined"); i++) await sleep(100);
check("гравець зайшов у кімнату по ws", types.has("joined"));

const t0 = performance.now();
docker("stop", NAME); // за замовчуванням чекає 10 с і лише потім SIGKILL
const stopMs = performance.now() - t0;
check(
	"docker stop швидше за 10 с",
	stopMs < 9500,
	`${(stopMs / 1000).toFixed(2)} с`,
);
const code = await Promise.race([closeCode, sleep(2000).then(() => "немає")]);
check("клієнт отримав закриття 1001", code === 1001, String(code));
check("клієнт отримав повідомлення shutdown", types.has("shutdown"));
const exit = out(docker("inspect", "-f", "{{.State.ExitCode}}", NAME));
check("код виходу 0 (graceful, не SIGKILL=137)", exit === "0", exit);

// 6. логи
const logs = docker("logs", NAME);
const lines = `${logs.stdout}${logs.stderr}`.split("\n").filter(Boolean);
const bad = lines.filter((l) => {
	try {
		JSON.parse(l);
		return false;
	} catch {
		return true;
	}
});
check(
	"усі рядки логу це JSON",
	lines.length > 0 && bad.length === 0,
	bad[0] ?? `${lines.length} рядків`,
);
check(
	"у логу є «зупинено»",
	lines.some((l) => l.includes("зупинено")),
);

cleanup();
const failed = checks.filter((c) => !c.ok);
console.log(
	failed.length === 0
		? "\nУсе гаразд."
		: `\nПровалено перевірок: ${failed.length}`,
);
process.exit(failed.length === 0 ? 0 : 1);
