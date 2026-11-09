export function sendJson(res, status, body) {
	const data = Buffer.from(JSON.stringify(body));
	res.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
		"Content-Length": data.length,
		"Cache-Control": "no-store",
	});
	res.end(data);
}

export function sendText(res, status, text) {
	const data = Buffer.from(text);
	res.writeHead(status, {
		"Content-Type": "text/plain; charset=utf-8",
		"Content-Length": data.length,
	});
	res.end(data);
}

export class HttpError extends Error {
	constructor(status, message, { close = false } = {}) {
		super(message);
		this.name = "HttpError";
		this.status = status;
		this.close = close; // закрити з'єднання після відповіді (тіло запиту не дочитано)
	}
}

export function sendError(req, res, error) {
	if (error.close) {
		res.setHeader("Connection", "close");
		res.once("finish", () => req.destroy());
	}
	sendJson(res, error.status, { error: error.message });
}
