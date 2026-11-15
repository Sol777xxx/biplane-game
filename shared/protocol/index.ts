import { z } from "zod";
import {
	type EntityId,
	isEntityId,
	isSeq,
	isTick,
	MAX_SEQ,
	type Seq,
	type Tick,
} from "../sim/ids.ts";

// Протокол: JSON-повідомлення { v, type, ... }. Версія конверта лишається 1:
// нові типи додаються без зміни старих. Це єдине джерело правди: схеми Zod
// перевіряють дані в рантаймі, а типи TypeScript виводяться з тих самих схем.
//
// клієнт → сервер: join, chat, leave, input, ping, netsim
// сервер → клієнт: joined, roster, chat, error, pong, snapshot, netsim
//
// input: { seq, up, down, left, right, fire }
//   seq росте на 1 з кожним input, починаючи з 1; підтвердження 0 = «нічого не оброблено».
// ping/pong: { t } (сервер повертає t без змін, клієнт рахує RTT).
// netsim (лише для розробки, потрібен ENABLE_NETSIM=1 на сервері):
//   клієнт → сервер: { lag, jitter, loss }, межі в NETSIM_LIMITS;
//   сервер → клієнт: { enabled, lag, jitter, loss } (поточні значення).
export const PROTOCOL_VERSION = 1;

export { MAX_SEQ };

export const MSG = Object.freeze({
	JOIN: "join",
	CHAT: "chat",
	LEAVE: "leave",
	INPUT: "input",
	PING: "ping",
	NETSIM: "netsim",
	JOINED: "joined",
	ROSTER: "roster",
	ERROR: "error",
	PONG: "pong",
	SNAPSHOT: "snapshot",
});

// коди закриття WebSocket: стандартні (1xxx) і наші (4xxx)
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

export type InputKey = "up" | "down" | "left" | "right" | "fire";

// стан вводу: рівно ці ключі читає Biplane.update
export const INPUT_KEYS: readonly InputKey[] = Object.freeze([
	"up",
	"down",
	"left",
	"right",
	"fire",
]);

// межі штучної мережі: lag і jitter в мс (RTT), loss у відсотках
export const NETSIM_LIMITS = Object.freeze({
	lag: Object.freeze<[number, number]>([0, 1000]),
	jitter: Object.freeze<[number, number]>([0, 500]),
	loss: Object.freeze<[number, number]>([0, 50]),
});

// ---------- будівельні блоки схем ----------

const CONTROL = /\p{Cc}/u;

// текст без керівних символів; пробіли по краях обрізаємо, довжина 1..max
const text = (max: number) =>
	z
		.string()
		.trim()
		.min(1)
		.max(max)
		.refine((s) => !CONTROL.test(s), "control characters");

// Branded-значення: перевіряємо захисником типу, тож на виході Seq, а не просто number.
const seqSchema = z.custom<Seq>(
	(v) => typeof v === "number" && isSeq(v),
	"bad seq",
);
const tickSchema = z.custom<Tick>(
	(v) => typeof v === "number" && isTick(v),
	"bad tick",
);
const entityIdSchema = z.custom<EntityId>(
	(v) => typeof v === "number" && isEntityId(v),
	"bad id",
);

const num = z.number();
const flag = z.boolean();

// кожне повідомлення має версію й літерал type: за ним працює z.discriminatedUnion
const head = <T extends string>(type: T) => ({
	v: z.literal(PROTOCOL_VERSION),
	type: z.literal(type),
});

// ---------- клієнт → сервер (strict: зайве поле це помилка) ----------

export const joinSchema = z.strictObject({
	...head("join"),
	room: z.string().regex(/^[\w-]{1,32}$/),
	name: text(16),
});
export const chatSchema = z.strictObject({ ...head("chat"), text: text(200) });
export const leaveSchema = z.strictObject({ ...head("leave") });
export const inputSchema = z.strictObject({
	...head("input"),
	seq: seqSchema,
	up: flag,
	down: flag,
	left: flag,
	right: flag,
	fire: flag,
});
export const pingSchema = z.strictObject({
	...head("ping"),
	t: z.number().min(0).max(Number.MAX_SAFE_INTEGER), // мітка часу клієнта
});
export const netsimRequestSchema = z.strictObject({
	...head("netsim"),
	lag: z.number().int().min(NETSIM_LIMITS.lag[0]).max(NETSIM_LIMITS.lag[1]),
	jitter: z
		.number()
		.int()
		.min(NETSIM_LIMITS.jitter[0])
		.max(NETSIM_LIMITS.jitter[1]),
	loss: z.number().min(NETSIM_LIMITS.loss[0]).max(NETSIM_LIMITS.loss[1]),
});

export const clientMessageSchema = z.discriminatedUnion("type", [
	joinSchema,
	chatSchema,
	leaveSchema,
	inputSchema,
	pingSchema,
	netsimRequestSchema,
]);

// ---------- сервер → клієнт ----------

const rosterEntrySchema = z.object({ id: z.string(), name: z.string() });

const arenaSchema = z.object({
	obstacles: num,
	pickupEvery: num,
	homingChance: num,
	speed: num,
	refillEvery: num,
});

const roomSummarySchema = z.object({
	id: z.string(),
	name: z.string(),
	players: num,
	max: num,
	arena: arenaSchema,
});

const simKindSchema = z.enum(["biplane", "bullet", "obstacle", "pickup"]);
const pickupTypeSchema = z.enum(["shield", "rapid", "homing"]);

// Подія для мережі (косметика: звук, ефекти). Стан гри з неї не відновлюється.
export const wireEventSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("fired"),
		player: z.string().nullable(),
		x: num,
		y: num,
	}),
	z.object({ type: z.literal("hit"), kind: simKindSchema, x: num, y: num }),
	z.object({
		type: z.literal("exploded"),
		kind: simKindSchema,
		x: num,
		y: num,
		size: num,
		color: z.enum(["pink", "storm"]),
		count: num,
	}),
	z.object({
		type: z.literal("scored"),
		player: z.string(),
		delta: num,
		x: num,
		y: num,
	}),
	z.object({
		type: z.literal("pickup"),
		player: z.string().nullable(),
		pickup: pickupTypeSchema,
	}),
	z.object({
		type: z.literal("crash"),
		player: z.string().nullable(),
		x: num,
		y: num,
	}),
	z.object({
		type: z.literal("respawned"),
		player: z.string(),
		x: num,
		y: num,
	}),
]);

const playerSnapshotSchema = z.object({
	id: z.string(),
	score: num,
	destroyed: num,
	crashes: num,
	deaths: num,
});
const shipSnapshotSchema = z.object({
	id: entityIdSchema,
	player: z.string(),
	x: num,
	y: num,
	vx: num,
	vy: num,
	pitch: num,
	facing: num,
	hp: num,
	cooldown: num,
	shield: num,
	rapid: num,
	homing: num,
});
const obstacleSnapshotSchema = z.object({
	id: entityIdSchema,
	x: num,
	y: num,
	vx: num,
	vy: num,
	r: num,
});
const bulletSnapshotSchema = z.object({
	id: entityIdSchema,
	owner: z.string().nullable(),
	seq: seqSchema, // seq input-пострілу (0: повтор клавіш)
	x: num,
	y: num,
	vx: num,
	vy: num,
	ttl: num,
});
const pickupSnapshotSchema = z.object({
	id: entityIdSchema,
	type: pickupTypeSchema,
	x: num,
	y: num,
	life: num,
});

// Знімок стану гри. Масиви readonly: знімок це дані, їх читають, а не змінюють.
export const snapshotSchema = z.object({
	tick: tickSchema,
	players: z.array(playerSnapshotSchema).readonly(),
	ships: z.array(shipSnapshotSchema).readonly(),
	obstacles: z.array(obstacleSnapshotSchema).readonly(),
	bullets: z.array(bulletSnapshotSchema).readonly(),
	pickups: z.array(pickupSnapshotSchema).readonly(),
});

export const joinedSchema = z.object({
	...head("joined"),
	you: rosterEntrySchema,
	room: roomSummarySchema,
	players: z.array(rosterEntrySchema).readonly(),
});
export const rosterSchema = z.object({
	...head("roster"),
	players: z.array(rosterEntrySchema).readonly(),
});
export const chatBroadcastSchema = z.object({
	...head("chat"),
	t: num,
	from: z.string(),
	name: z.string(),
	text: z.string(),
});
export const errorSchema = z.object({
	...head("error"),
	code: num,
	message: z.string(),
});
export const pongSchema = z.object({ ...head("pong"), t: num });
export const netsimStateSchema = z.object({
	...head("netsim"),
	enabled: flag,
	lag: num,
	jitter: num,
	loss: num,
});
export const snapshotMessageSchema = z.object({
	...head("snapshot"),
	...snapshotSchema.shape,
	ack: seqSchema,
	events: z.array(wireEventSchema).readonly().default([]),
});

export const serverMessageSchema = z.discriminatedUnion("type", [
	joinedSchema,
	rosterSchema,
	chatBroadcastSchema,
	errorSchema,
	pongSchema,
	netsimStateSchema,
	snapshotMessageSchema,
]);

// ---------- типи: виведені зі схем, окремо вручну нічого не описуємо ----------

export type JoinMessage = z.infer<typeof joinSchema>;
export type InputMessage = z.infer<typeof inputSchema>;
export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type ServerMessage = z.infer<typeof serverMessageSchema>;
export type SnapshotMessage = z.infer<typeof snapshotMessageSchema>;
export type Message = ClientMessage | ServerMessage;
export type MessageType = Message["type"];
export type MessageOf<T extends MessageType> = Extract<Message, { type: T }>;

export type WireEvent = z.infer<typeof wireEventSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export type PlayerSnapshot = Snapshot["players"][number];
export type ShipSnapshot = Snapshot["ships"][number];
export type ObstacleSnapshot = Snapshot["obstacles"][number];
export type BulletSnapshot = Snapshot["bullets"][number];
export type PickupSnapshot = Snapshot["pickups"][number];

export type InputKeys = Readonly<Record<InputKey, boolean>>;

// ---------- перевірка вхідного ----------

export type ParseResult<T> =
	| { readonly ok: true; readonly msg: T }
	| { readonly ok: false; readonly code: number; readonly reason: string };

const bad = (reason: string): ParseResult<never> => ({
	ok: false,
	code: CLOSE.BAD_FORMAT,
	reason,
});

const envelopeSchema = z.object({
	v: z.literal(PROTOCOL_VERSION),
	type: z.string(),
});

const CLIENT_TYPES = {
	join: joinSchema,
	chat: chatSchema,
	leave: leaveSchema,
	input: inputSchema,
	ping: pingSchema,
	netsim: netsimRequestSchema,
};

const SERVER_TYPES = {
	joined: joinedSchema,
	roster: rosterSchema,
	chat: chatBroadcastSchema,
	error: errorSchema,
	pong: pongSchema,
	netsim: netsimStateSchema,
	snapshot: snapshotMessageSchema,
};

// Причина для логу й close-кадру (там максимум 123 байти): перше проблемне поле.
function reasonOf(error: z.ZodError): string {
	const issue = error.issues[0];
	const path = issue?.path.map(String).join(".");
	return (path ? `bad ${path}` : "wrong shape").slice(0, 100);
}

// raw це unknown: типи в рантаймі стерті, тому все, що прийшло ззовні, перевіряє схема.
function parseWith<S extends z.ZodType>(
	schema: S,
	known: object,
	raw: unknown,
): ParseResult<z.infer<S>> {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return bad("message must be an object");
	}
	const head = envelopeSchema.safeParse(raw);
	if (!head.success) {
		const first = head.error.issues[0]?.path[0];
		return bad(
			first === "v" ? "unsupported protocol version" : "type must be a string",
		);
	}
	// hasOwn, а не "in": інакше "toString" чи "__proto__" минули б перевірку
	if (!Object.hasOwn(known, head.data.type)) {
		return { ok: false, code: CLOSE.UNKNOWN_TYPE, reason: "unknown type" };
	}
	const result = schema.safeParse(raw);
	return result.success
		? { ok: true, msg: result.data }
		: bad(reasonOf(result.error));
}

// Сервер не довіряє нічому з того, що прийшло: приймає unknown, віддає ClientMessage.
export function parseClientMessage(raw: unknown): ParseResult<ClientMessage> {
	return parseWith(clientMessageSchema, CLIENT_TYPES, raw);
}

// Те саме для клієнта: сервер теж можна зламати або підмінити.
export function parseServerMessage(raw: unknown): ParseResult<ServerMessage> {
	return parseWith(serverMessageSchema, SERVER_TYPES, raw);
}

// ---------- конструктори ----------

// дані повідомлення без v і type (розподілено по об'єднанню: у netsim два види)
export type MessageData<T extends MessageType> =
	MessageOf<T> extends infer M
		? M extends unknown
			? Omit<M, "v" | "type">
			: never
		: never;

// Таблиця будівельників: для кожного type свій, тож приведення типів не потрібне.
// Тип { [T in MessageType]: … } вимагає запис для КОЖНОГО повідомлення протоколу.
const BUILD: {
	readonly [T in MessageType]: (data: MessageData<T>) => MessageOf<T>;
} = {
	join: (d) => ({ v: PROTOCOL_VERSION, type: "join", ...d }),
	chat: (d) => ({ v: PROTOCOL_VERSION, type: "chat", ...d }),
	leave: (d) => ({ v: PROTOCOL_VERSION, type: "leave", ...d }),
	input: (d) => ({ v: PROTOCOL_VERSION, type: "input", ...d }),
	ping: (d) => ({ v: PROTOCOL_VERSION, type: "ping", ...d }),
	netsim: (d) => ({ v: PROTOCOL_VERSION, type: "netsim", ...d }),
	joined: (d) => ({ v: PROTOCOL_VERSION, type: "joined", ...d }),
	roster: (d) => ({ v: PROTOCOL_VERSION, type: "roster", ...d }),
	error: (d) => ({ v: PROTOCOL_VERSION, type: "error", ...d }),
	pong: (d) => ({ v: PROTOCOL_VERSION, type: "pong", ...d }),
	snapshot: (d) => ({ v: PROTOCOL_VERSION, type: "snapshot", ...d }),
};

export function make<T extends MessageType>(
	type: T,
	data: MessageData<T>,
): MessageOf<T> {
	return BUILD[type](data);
}

// повідомлення input із довільного стану вводу: усі ключі булеві, зайве відкидається
export function makeInput(
	seq: Seq,
	keys: Readonly<Record<string, unknown>> | null | undefined,
): InputMessage {
	return {
		v: PROTOCOL_VERSION,
		type: "input",
		seq,
		up: Boolean(keys?.up),
		down: Boolean(keys?.down),
		left: Boolean(keys?.left),
		right: Boolean(keys?.right),
		fire: Boolean(keys?.fire),
	};
}

// назад: лише ключі вводу, без v, type і seq
export function inputFromMessage(
	msg: Readonly<Record<InputKey, boolean>>,
): InputKeys {
	return {
		up: msg.up === true,
		down: msg.down === true,
		left: msg.left === true,
		right: msg.right === true,
		fire: msg.fire === true,
	};
}
