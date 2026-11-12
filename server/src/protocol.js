import {
	INPUT_KEYS,
	MAX_SEQ,
	make,
	PROTOCOL_VERSION,
} from "biplane-shared/protocol/index.js";

// Протокол: JSON-повідомлення { v, type, ... }. Сервер не довіряє нічому з того, що прийшло.
// Типи й конструктори спільні з клієнтом (shared/protocol), тут лише перевірка вхідного.
export { make, PROTOCOL_VERSION };
export const MAX_MESSAGE_BYTES = 2048;

export const CLOSE = Object.freeze({
	NORMAL: 1000,
	GOING_AWAY: 1001,
	UNSUPPORTED: 1003,
	TOO_BIG: 1009,
	INTERNAL: 1011,
	BAD_FORMAT: 4000,
	UNKNOWN_TYPE: 4001,
	JOIN_TIMEOUT: 4002,
	NOT_JOINED: 4003,
	ALREADY_JOINED: 4004,
	ROOM_NOT_FOUND: 4005,
	ROOM_FULL: 4006,
	NAME_TAKEN: 4007,
	RATE_LIMIT: 4008,
	SLOW_CLIENT: 4009,
});

const CONTROL = /\p{Cc}/u;

const text = (max) => (value) => {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length >= 1 && trimmed.length <= max && !CONTROL.test(trimmed)
		? trimmed
		: undefined;
};

// лише справжні булеві: 1, "true", null вводом не є
const bool = (value) => (typeof value === "boolean" ? value : undefined);

const seq = (value) =>
	Number.isSafeInteger(value) && value >= 0 && value <= MAX_SEQ
		? value
		: undefined;

// мітка часу клієнта для ping: скінченне число ≥ 0
const stamp = (value) =>
	typeof value === "number" &&
	Number.isFinite(value) &&
	value >= 0 &&
	value <= Number.MAX_SAFE_INTEGER
		? value
		: undefined;

// кожне поле повертає очищене значення або undefined (= не пройшло)
const FIELDS = {
	room: (value) =>
		typeof value === "string" && /^[\w-]{1,32}$/.test(value)
			? value
			: undefined,
	name: text(16),
	text: text(200),
	seq,
	t: stamp,
	...Object.fromEntries(INPUT_KEYS.map((key) => [key, bool])),
};

// які поля має мати повідомлення кожного типу (понад v і type)
const SCHEMAS = {
	join: ["room", "name"],
	chat: ["text"],
	leave: [],
	input: ["seq", ...INPUT_KEYS],
	ping: ["t"],
};

const bad = (reason) => ({ ok: false, code: CLOSE.BAD_FORMAT, reason });

export function validate(raw) {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return bad("message must be an object");
	}
	if (raw.v !== PROTOCOL_VERSION) return bad("unsupported protocol version");
	if (typeof raw.type !== "string") return bad("type must be a string");
	// hasOwn, а не "in": інакше "toString" чи "__proto__" минули б перевірку
	if (!Object.hasOwn(SCHEMAS, raw.type)) {
		return { ok: false, code: CLOSE.UNKNOWN_TYPE, reason: "unknown type" };
	}

	const wanted = SCHEMAS[raw.type];
	const extra = Object.keys(raw).filter((k) => k !== "v" && k !== "type");
	if (
		extra.length !== wanted.length ||
		extra.some((k) => !wanted.includes(k))
	) {
		return bad("wrong shape");
	}

	const msg = { v: raw.v, type: raw.type };
	for (const key of wanted) {
		const value = FIELDS[key](raw[key]);
		if (value === undefined) return bad(`bad ${key}`);
		msg[key] = value;
	}
	return { ok: true, msg };
}
