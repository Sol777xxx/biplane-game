// Запуск: node tools/bigframe.mjs [url]. Надсилає кадр більший за maxPayload (2048 Б).
import WebSocket from "ws";

const ws = new WebSocket(process.argv[2] ?? "ws://127.0.0.1:3000/ws");
ws.on("open", () => {
	ws.send(JSON.stringify({ v: 1, type: "join", room: "calm", name: "big" }));
	ws.send(JSON.stringify({ v: 1, type: "chat", text: "x".repeat(3000) }));
});
ws.on("close", (code) => {
	console.log("закрито:", code);
	process.exit(0);
});
ws.on("error", (error) => console.log("клієнт:", error.message));
