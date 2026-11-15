import { binary } from "./binary.ts";
import type { Codec } from "./codec.ts";
import { json } from "./json.ts";

export type { BinaryCodec, Codec, Frame, TextCodec } from "./codec.ts";
export { CodecError } from "./codec.ts";

export const CODECS = Object.freeze({ json, binary });
export type CodecName = keyof typeof CODECS;

// hasOwn, а не "in": інакше "toString" чи "__proto__" минули б перевірку
const isCodecName = (name: unknown): name is CodecName =>
	typeof name === "string" && Object.hasOwn(CODECS, name);

// невідоме ім'я це json (кодек за замовчуванням)
export function getCodec(name: unknown): Codec {
	return isCodecName(name) ? CODECS[name] : json;
}
