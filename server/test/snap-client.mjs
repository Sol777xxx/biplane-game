// Запуск: node tools/snap-client.mjs [кімната] [url] [секунд=5]
// Заходить у кімнату, шле 30 input/с («вправо»), рахує знімки й байти, наприкінці
// показує свій корабель і розділ /api/stats цієї кімнати.
import WebSocket from "ws";

const [room = "calm", url = "ws://127.0.0.1:3000/ws", secondsArg = "5"] =
	process.argv.slice(2);
const seconds = Number(secondsArg);
const ws = new WebSocket(url);

let you = null;
let seq = 0;
let count = 0;
let bytes = 0;
let last = null;
let timer = null;

const send = (message) => ws.send(JSON.stringify({ v: 1, ...message }));

function start() {
	timer = setInterval(() => {
		seq++;
		send({
			type: "input",
			seq,
			up: false,
			down: false,
			left: false,
			right: true,
			fire: seq % 10 < 3,
		});
	}, 1000 / 30);
	setTimeout(finish, seconds * 1000);
}

async function finish() {
	clearInterval(timer);
	const ship = last?.ships.find((s) => s.player === you);
	console.log(`знімків: ${count} (${(count / seconds).toFixed(1)}/с)`);
	console.log(
		`середній розмір: ${Math.round(bytes / Math.max(count, 1))} байт`,
	);
	console.log(
		`останній: tick ${last?.tick}, ack ${last?.ack}, надіслано input ${seq}`,
	);
	if (ship) {
		console.log(
			`корабель: x=${ship.x} y=${ship.y} vx=${ship.vx} hp=${ship.hp}`,
		);
	}
	const statsUrl = url.replace(/^ws/, "http").replace(/\/ws$/, "/api/stats");
	try {
		const { rooms } = await (await fetch(statsUrl)).json();
		console.log(
			JSON.stringify(
				rooms.find((r) => r.id === room),
				null,
				2,
			),
		);
	} catch (error) {
		console.log("stats:", error.message);
	}
	ws.close(1000, "done");
}

ws.on("open", () => send({ type: "join", room, name: "snap-cli" }));
ws.on("message", (data) => {
	const m = JSON.parse(data.toString());
	if (m.type === "joined") {
		you = m.you.id;
		start();
	} else if (m.type === "snapshot") {
		count++;
		bytes += data.length;
		last = m;
	} else if (m.type === "error") {
		console.log("error:", m.code, m.message);
	}
});
ws.on("close", (code) => {
	console.log(`закрито: ${code}`);
	process.exit(0);
});
ws.on("error", (error) => console.error(error.message));
