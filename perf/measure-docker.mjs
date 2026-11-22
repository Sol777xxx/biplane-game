// Місткість і збої на справжньому образі Docker (лаб 8): скільки гравців витримує один процес.
// Образ запускається з обмеженням ЦП: 1 ядро і «як на безкоштовному Render» (0,1 ядра, 512 МБ),
// на кожному обмеженні loadtest шукає найбільше N, де тік p99 ≤ 33,3 мс; потім chaos vanish/flood.
//
//   node perf/measure-docker.mjs                (збирає образ biplane-game:measure, якщо його немає)
//   node perf/measure-docker.mjs --image ghcr.io/sol777xxx/biplane-game:latest --seconds 15
//
// Результат: docs/perf/loadtest-docker-*.{json,md,svg} і docs/chaos/chaos-docker.{json,md}
import { spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
	options: {
		image: { type: "string", default: "biplane-game:measure" },
		port: { type: "string", default: "4183" },
		seconds: { type: "string", default: "15" },
	},
});

const run = (cmd, argv, opts = {}) => {
	const r = spawnSync(cmd, argv, { stdio: "inherit", ...opts });
	if (r.status !== 0)
		throw new Error(`${cmd} ${argv.join(" ")} завершилась з кодом ${r.status}`);
};
const quiet = (cmd, argv) => spawnSync(cmd, argv, { encoding: "utf8" });

if (
	quiet("docker", ["version", "--format", "{{.Server.Version}}"]).status !== 0
) {
	console.error("Docker недоступний: запустіть Docker Desktop.");
	process.exit(2);
}
if (quiet("docker", ["image", "inspect", args.image]).status !== 0) {
	console.log(`образу ${args.image} немає, збираю…`);
	run("docker", [
		"build",
		"-t",
		args.image,
		"--build-arg",
		"GIT_SHA=measure",
		".",
	]);
}

const NAME = "biplane-measure";
const base = `http://127.0.0.1:${args.port}`;

async function withContainer(limits, fn) {
	quiet("docker", ["rm", "-f", NAME]);
	run("docker", [
		"run",
		"-d",
		"--rm",
		"--name",
		NAME,
		"-p",
		`${args.port}:3000`,
		...limits,
		// на одній адресі 127.0.0.1 сотні тестових клієнтів: ліміти хостингу вимикаємо
		"-e",
		"MAX_CONN_PER_IP=100000",
		"-e",
		"MAX_PLAYERS=100000",
		"-e",
		"MAX_ROOMS=1000",
		"-e",
		"LOG_LEVEL=error",
		args.image,
	]);
	try {
		for (let i = 0; i < 100; i++) {
			try {
				if ((await fetch(`${base}/ready`)).ok) break;
			} catch {}
			await sleep(200);
		}
		await fn();
	} finally {
		quiet("docker", ["rm", "-f", NAME]);
	}
}

const profiles = [
	{
		label: "docker-cpu1",
		limits: ["--cpus", "1", "--memory", "512m"],
		levels: "8,32,64,128",
	},
	// безкоштовний Render: 0,1 ядра й 512 МБ (перевірте цифри в документації Render)
	{
		label: "docker-render-free",
		limits: ["--cpus", "0.1", "--memory", "512m"],
		levels: "2,4,8,16,32",
	},
];

for (const p of profiles) {
	console.log(`\n=== ${p.label}: ${p.limits.join(" ")} ===`);
	await withContainer(p.limits, async () => {
		run("node", [
			"perf/loadtest.mjs",
			"--url",
			base,
			"--label",
			p.label,
			"--levels",
			p.levels,
			"--seconds",
			args.seconds,
			"--until-fail",
			"--per-room",
			"8",
		]);
	});
}

console.log("\n=== збої на образі (vanish, flood) ===");
await withContainer(["--cpus", "1", "--memory", "512m"], async () => {
	run("node", ["perf/chaos.mjs", "vanish", "--url", base, "--label", "docker"]);
});
await withContainer(["--cpus", "1", "--memory", "512m"], async () => {
	run("node", [
		"perf/chaos.mjs",
		"flood",
		"--url",
		base,
		"--label",
		"docker-flood",
	]);
});
console.log("\nГотово. Додайте docs/perf і docs/chaos до коміту.");
