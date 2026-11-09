// Протокол v0: JSON-повідомлення { v, type, ... }. Сервер не довіряє нічому з того, що прийшло.
export const PROTOCOL_VERSION = 1;
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

// кожне поле повертає очищене значення або undefined (= не пройшло)
const FIELDS = {
	room: (value) =>
		typeof value === "string" && /^[\w-]{1,32}$/.test(value)
			? value
			: undefined,
	name: text(16),
	text: text(200),
};

// які поля має мати повідомлення кожного типу (понад v і type)
const SCHEMAS = {
	join: ["room", "name"],
	chat: ["text"],
	leave: [],
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

// повідомлення сервера клієнтові: joined, roster, chat, error
export function make(type, data = {}) {
	return { v: PROTOCOL_VERSION, type, ...data };
}
