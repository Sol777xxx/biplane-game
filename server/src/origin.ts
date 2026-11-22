import type { IncomingMessage } from "node:http";

// Перевірка заголовка Origin на рукостисканні WebSocket.
//
// Браузер завжди додає Origin до WebSocket-запиту, і скрипт чужого сайту не може його
// підмінити. Без перевірки будь-яка сторінка в інтернеті відкрила б сокет до нашого сервера
// від імені гравця (cross-site WebSocket hijacking). Тому:
//  - Origin немає: це не браузер (тести, навантажувальні скрипти, curl). Origin
//    ставить сам клієнт, тож для не-браузера він нічого не доводить; пропускаємо;
//  - список ALLOWED_ORIGINS не порожній: Origin має бути в ньому дослівно;
//  - список порожній (розробка): Origin має збігатися з Host запиту, тобто сторінку
//    віддав той самий сервер.
export function isOriginAllowed(
	origin: string | undefined,
	host: string | undefined,
	allowed: readonly string[],
): boolean {
	if (origin === undefined) return true;
	if (allowed.length > 0) return allowed.includes(origin);
	if (host === undefined) return false;
	try {
		return new URL(origin).host === host;
	} catch {
		return false; // "null" і зламані значення
	}
}

// IP клієнта для ліміту з'єднань. Прямо: адреса сокета. За проксі хостингу сокет бачить
// лише проксі, тож (за TRUST_PROXY=1) беремо перший елемент X-Forwarded-For.
// Обмеження: клієнт може сам дописати свій X-Forwarded-For, тож це захист від випадкового
// перевантаження з однієї адреси, а не від навмисного обходу.
export function clientIp(req: IncomingMessage, trustProxy: boolean): string {
	if (trustProxy) {
		const header = req.headers["x-forwarded-for"];
		const first = (Array.isArray(header) ? header[0] : header)
			?.split(",")[0]
			?.trim();
		if (first) return first;
	}
	return req.socket.remoteAddress ?? "unknown";
}
