// Протокол: JSON-повідомлення { v, type, ... }. Версія конверта лишається 1:
// нові типи додаються без зміни старих.
//
// клієнт → сервер: join, chat, leave, input, ping
// сервер → клієнт: joined, roster, chat, error, pong, snapshot
//
// input: { seq, up, down, left, right, fire }
//   seq росте на 1 з кожним input, починаючи з 1; підтвердження 0 = «нічого не оброблено».
// ping/pong: { t } (сервер повертає t без змін, клієнт рахує RTT).
export const PROTOCOL_VERSION = 1;

export const MSG = Object.freeze({
	JOIN: "join",
	CHAT: "chat",
	LEAVE: "leave",
	INPUT: "input",
	PING: "ping",
	JOINED: "joined",
	ROSTER: "roster",
	ERROR: "error",
	PONG: "pong",
	SNAPSHOT: "snapshot",
});

// стан вводу: рівно ці ключі читає Biplane.update
export const INPUT_KEYS = Object.freeze([
	"up",
	"down",
	"left",
	"right",
	"fire",
]);

// seq вміщується в Uint32 (у бінарному форматі це 4 байти)
export const MAX_SEQ = 0xffffffff;

export function make(type, data = {}) {
	return { v: PROTOCOL_VERSION, type, ...data };
}

// повідомлення input із довільного стану вводу: усі ключі булеві, зайве відкидається
export function makeInput(seq, keys) {
	const msg = make(MSG.INPUT, { seq });
	for (const key of INPUT_KEYS) msg[key] = Boolean(keys?.[key]);
	return msg;
}

// назад: лише ключі вводу, без v, type і seq
export function inputFromMessage(msg) {
	const keys = {};
	for (const key of INPUT_KEYS) keys[key] = msg[key] === true;
	return keys;
}
