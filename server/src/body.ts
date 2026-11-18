import type { IncomingMessage } from "node:http";
import { HttpError } from "./respond.ts";

// Читає JSON-тіло з жорстким лімітом. Ліміт діє двічі: за заголовком
// Content-Length (відповідаємо, нічого не читаючи) і за фактичними байтами.
// Повертає unknown: що саме прийшло, вирішує той, хто викликає, а не JSON.parse.
export function readJsonBody(
	req: IncomingMessage,
	limit: number,
): Promise<unknown> {
	return new Promise((resolve, reject) => {
		if (!/^application\/json\b/i.test(req.headers["content-type"] ?? "")) {
			return reject(
				new HttpError(415, "потрібен Content-Type: application/json"),
			);
		}
		const declared = Number(req.headers["content-length"]);
		if (declared > limit) {
			return reject(
				new HttpError(413, `тіло більше за ${limit} байт`, { close: true }),
			);
		}

		const chunks: Buffer[] = [];
		let size = 0;
		let tooBig = false;
		req.on("data", (chunk: Buffer) => {
			if (tooBig) return;
			size += chunk.length;
			if (size > limit) {
				tooBig = true;
				chunks.length = 0; // уже зібране викидаємо
				reject(
					new HttpError(413, `тіло більше за ${limit} байт`, { close: true }),
				);
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			if (tooBig) return;
			try {
				const parsed: unknown = JSON.parse(
					Buffer.concat(chunks).toString("utf8"),
				);
				resolve(parsed);
			} catch {
				reject(new HttpError(400, "некоректний JSON"));
			}
		});
		req.on("error", reject);
	});
}
