// Запуск: node tools/chat-client.mjs [кімната] [ім'я] [url]
// Рядки з клавіатури йдуть у чат; Ctrl+C виходить.
import readline from "node:readline";
import WebSocket from "ws";

const [room = "calm", name = "cli", url = "ws://127.0.0.1:3000/ws"] =
	process.argv.slice(2);
const ws = new WebSocket(url);

ws.on("open", () =>
	ws.send(JSON.stringify({ v: 1, type: "join", room, name })),
);
ws.on("message", (data) => console.log("<-", data.toString()));
ws.on("close", (code, reason) => {
	console.log("закрито:", code, reason.toString());
	process.exit(0);
});
ws.on("error", (error) => console.error("помилка:", error.message));

readline.createInterface({ input: process.stdin }).on("line", (line) => {
	ws.send(JSON.stringify({ v: 1, type: "chat", text: line }));
});
