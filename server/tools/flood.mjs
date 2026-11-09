// Запуск: node tools/flood.mjs [кількість=50] [url]
import WebSocket from "ws";

const [countArg = "50", url = "ws://127.0.0.1:3000/ws"] = process.argv.slice(2);
const ws = new WebSocket(url);

ws.on("open", () => {
	ws.send(JSON.stringify({ v: 1, type: "join", room: "calm", name: "flood" }));
	for (let i = 0; i < Number(countArg); i++) {
		ws.send(JSON.stringify({ v: 1, type: "chat", text: `спам ${i}` }));
	}
});
ws.on("close", (code, reason) => {
	console.log("закрито:", code, reason.toString());
	process.exit(0);
});
ws.on("error", (error) => console.error(error.message));
