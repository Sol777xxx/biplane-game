import { binary } from "./binary.js";
import { json } from "./json.js";

export const CODECS = Object.freeze({ json, binary });

// невідоме ім'я це json (кодек за замовчуванням)
export function getCodec(name) {
	return typeof name === "string" && Object.hasOwn(CODECS, name)
		? CODECS[name]
		: json;
}
