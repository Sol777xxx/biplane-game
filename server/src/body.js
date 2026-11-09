import { HttpError } from "./respond.js";

// Читає JSON-тіло з жорстким лімітом. Ліміт діє двічі: за заголовком
// Content-Length (відповідаємо, нічого не читаючи) і за фактичними байтами.
export function readJsonBody(req, limit) {
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

		const chunks = [];
		let size = 0;
		let tooBig = false;
		req.on("data", (chunk) => {
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
				resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
			} catch {
				reject(new HttpError(400, "некоректний JSON"));
			}
		});
		req.on("error", reject);
	});
}
