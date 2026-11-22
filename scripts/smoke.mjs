// Перевірка живого сервера: /health (git SHA), /ready, потім справжній WebSocket (wss:// для
// https-адреси): рукостискання з Origin сторінки, join у кімнату, кілька ping для RTT.
//
//   node scripts/smoke.mjs https://biplane-game.onrender.com
//   node scripts/smoke.mjs https://… --expect-sha <sha> --wait 600   (CI після деплою)
//
// Код виходу 0: усе гаразд. Результат (JSON) іде в stdout: RTT можна вставити в README.
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import WebSocket from "ws";

const { values: args, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		"expect-sha": { type: "string" },
		wait: { type: "string", default: "0" }, // скільки секунд чекати, поки сервер оновиться
		room: { type: "string", default: "calm" },
		pings: { type: "string", default: "10" },
	},
});

const target = positionals[0];
if (!target) {
	console.error(
		"Використання: node scripts/smoke.mjs <https://адреса> [--expect-sha SHA] [--wait сек]",
	);
	process.exit(2);
}
const base = new URL(target);
const wsUrl = `${base.protocol === "https:" ? "wss:" : "ws:"}//${base.host}/ws`;
const fail = (message) => {
	console.error(`FAIL: ${message}`);
	process.exit(1);
};

async function getJson(path) {
	const res = await fetch(new URL(path, base), {
		signal: AbortSignal.timeout(15_000),
	});
	return { status: res.status, body: await res.json().catch(() => null) };
}

// 1. /health: чекаємо, поки відповість процес із потрібним SHA (деплой може тривати хвилини)
const deadline = Date.now() + Number(args.wait) * 1000;
let health = null;
for (;;) {
	try {
		const r = await getJson("/health");
		const okSha = !args["expect-sha"] || r.body?.sha === args["expect-sha"];
		if (r.status === 200 && okSha) {
			health = r.body;
			break;
		}
		console.log(`чекаю: /health ${r.status}, sha=${r.body?.sha ?? "—"}`);
	} catch (error) {
		console.log(`чекаю: ${error.message}`);
	}
	if (Date.now() > deadline) {
		fail(
			`/health не віддав очікуваний SHA ${args["expect-sha"] ?? "(будь-який)"} за ${args.wait} с`,
		);
	}
	await sleep(5000);
}
console.log(`health: sha=${health.sha}, uptime=${health.uptime} с`);

// 2. /ready
const ready = await getJson("/ready");
if (ready.status !== 200)
	fail(`/ready ${ready.status}: ${JSON.stringify(ready.body)}`);

// 3. WebSocket: Origin сторінки, як у браузері
const ws = new WebSocket(wsUrl, { headers: { Origin: base.origin } });
const opened = performance.now();
const messages = [];
const waiters = [];
ws.on("message", (data) => {
	const msg = JSON.parse(data.toString());
	messages.push(msg);
	for (const w of waiters.splice(0)) w();
});
const waitFor = async (predicate, what, ms = 15_000) => {
	const end = Date.now() + ms;
	for (;;) {
		const found = messages.find(predicate);
		if (found) return found;
		if (Date.now() > end) fail(`не дочекався: ${what}`);
		await new Promise((resolve) => {
			waiters.push(resolve);
			setTimeout(resolve, 100);
		});
	}
};
await new Promise((resolve, reject) => {
	ws.once("open", resolve);
	ws.once("unexpected-response", (_req, res) =>
		reject(new Error(`рукостискання відхилено: HTTP ${res.statusCode}`)),
	);
	ws.once("error", reject);
}).catch((error) => fail(`${wsUrl}: ${error.message}`));
const connectMs = performance.now() - opened;

ws.send(
	JSON.stringify({
		v: 1,
		type: "join",
		room: args.room,
		name: `smoke-${Math.random().toString(36).slice(2, 6)}`,
	}),
);
await waitFor((m) => m.type === "joined", "joined");

// 4. RTT: ping → pong
const rtts = [];
for (let i = 0; i < Number(args.pings); i++) {
	const t = Date.now();
	const before = messages.length;
	ws.send(JSON.stringify({ v: 1, type: "ping", t }));
	await waitFor(
		(m) => m.type === "pong" && m.t === t && messages.indexOf(m) >= before,
		"pong",
	);
	rtts.push(Date.now() - t);
	await sleep(200);
}
ws.close();

rtts.sort((a, b) => a - b);
const pct = (p) =>
	rtts[Math.min(rtts.length - 1, Math.floor((p / 100) * rtts.length))];
const result = {
	url: wsUrl,
	sha: health.sha,
	connectMs: Math.round(connectMs),
	rttMs: {
		min: rtts[0],
		p50: pct(50),
		p95: pct(95),
		max: rtts.at(-1),
		samples: rtts.length,
	},
};
console.log(JSON.stringify(result, null, 2));
console.log("OK");
process.exit(0);
