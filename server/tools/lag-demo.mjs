// Запуск (сервер із ENABLE_SLOW=1): node tools/lag-demo.mjs [block|sleep] [host:port] [кімната]
import WebSocket from "ws";

const [mode = "block", host = "127.0.0.1:3000", room = "calm"] =
	process.argv.slice(2);
const DURATION_MS = 12_000;
const INTERVAL_MS = 250; // 4 повідомлення/с, нижче за ліміт 5/с
const SLOW_AT = [2000, 5000, 8000]; // коли смикаємо /api/slow

const ws = new WebSocket(`ws://${host}/ws`);
const sentAt = new Map();
const latencies = [];
let n = 0;

function start() {
	console.log(
		`режим: ${mode}; /api/slow?ms=300 у ${SLOW_AT.map((t) => t / 1000).join(", ")} с`,
	);
	setInterval(() => {
		const text = `p${n++}`;
		sentAt.set(text, performance.now());
		ws.send(JSON.stringify({ v: 1, type: "chat", text }));
	}, INTERVAL_MS);
	for (const t of SLOW_AT) {
		setTimeout(() => {
			fetch(`http://${host}/api/slow?mode=${mode}&ms=300`).catch(() => {});
		}, t);
	}
	setTimeout(finish, DURATION_MS);
}

function finish() {
	latencies.sort((a, b) => a - b);
	const median = latencies[Math.floor(latencies.length / 2)];
	const max = latencies.at(-1);
	const spikes = latencies.filter((ms) => ms >= 50).length;
	console.log(
		`\nпрозонд: ${latencies.length}, медіана ${median.toFixed(1)} мс, максимум ${max.toFixed(1)} мс, ≥ 50 мс: ${spikes}`,
	);
	process.exit(0);
}

ws.on("open", () =>
	ws.send(JSON.stringify({ v: 1, type: "join", room, name: "lag-probe" })),
);
ws.on("message", (data) => {
	const m = JSON.parse(data.toString());
	if (m.type === "joined") return start();
	if (m.type === "chat" && sentAt.has(m.text)) {
		const ms = performance.now() - sentAt.get(m.text);
		sentAt.delete(m.text);
		latencies.push(ms);
		if (ms >= 50)
			console.log(`${m.text}: ${ms.toFixed(0)} мс  ← цикл подій був зайнятий`);
	}
});
ws.on("close", (code, reason) => {
	console.log("закрито:", code, reason.toString());
	process.exit(code === 1000 ? 0 : 1);
});
ws.on("error", (error) => console.error(error.message));
