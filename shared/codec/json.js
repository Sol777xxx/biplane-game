import { makeInput } from "../protocol/index.js";

const decoder = new TextDecoder();
const text = (data) => (typeof data === "string" ? data : decoder.decode(data));

// JSON-кодек з тим самим інтерфейсом, що й бінарний (для порівняння).
// Перевірку вхідного робить сервер (validate), тому decode тут без неї.
export const json = Object.freeze({
	name: "json",
	isBinary: false,
	encodeSnapshot: (msg) => JSON.stringify(msg),
	decodeSnapshot: (data) => JSON.parse(text(data)),
	encodeInput: (seq, keys) => JSON.stringify(makeInput(seq, keys)),
	decodeInput: (data) => JSON.parse(text(data)),
});
