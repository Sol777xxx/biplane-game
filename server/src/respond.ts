import type { IncomingMessage, ServerResponse } from "node:http";

export function sendJson(
	res: ServerResponse,
	status: number,
	body: unknown,
): void {
	const data = Buffer.from(JSON.stringify(body));
	res.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
		"Content-Length": data.length,
		"Cache-Control": "no-store",
	});
	res.end(data);
}

export function sendText(
	res: ServerResponse,
	status: number,
	text: string,
): void {
	const data = Buffer.from(text);
	res.writeHead(status, {
		"Content-Type": "text/plain; charset=utf-8",
		"Content-Length": data.length,
	});
	res.end(data);
}

export class HttpError extends Error {
	readonly status: number;
	readonly close: boolean;

	constructor(
		status: number,
		message: string,
		{ close = false }: { close?: boolean } = {},
	) {
		super(message);
		this.name = "HttpError";
		this.status = status;
		this.close = close; // закрити з'єднання після відповіді (тіло запиту не дочитано)
	}
}

export function sendError(
	req: IncomingMessage,
	res: ServerResponse,
	error: HttpError,
): void {
	if (error.close) {
		res.setHeader("Connection", "close");
		res.once("finish", () => req.destroy());
	}
	sendJson(res, error.status, { error: error.message });
}
