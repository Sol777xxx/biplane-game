import {
	makeInput,
	parseClientMessage,
	parseServerMessage,
} from "../protocol/index.ts";
import { CodecError, type Frame, type TextCodec } from "./codec.ts";

const decoder = new TextDecoder();
const text = (data: Frame): string =>
	typeof data === "string" ? data : decoder.decode(data);

// JSON.parse віддає any, тому одразу кладемо результат в unknown:
// далі з ним працює лише схема Zod.
function parseJson(data: Frame): unknown {
	try {
		const parsed: unknown = JSON.parse(text(data));
		return parsed;
	} catch {
		throw new CodecError("некоректний JSON");
	}
}

// JSON-кодек з тим самим інтерфейсом, що й бінарний (для порівняння).
// Декодування перевіряє схема протоколу: кадру з мережі не довіряємо.
export const json: TextCodec = Object.freeze<TextCodec>({
	name: "json",
	isBinary: false,
	encodeSnapshot: (msg) => JSON.stringify(msg),
	decodeSnapshot: (data) => {
		const result = parseServerMessage(parseJson(data));
		if (!result.ok || result.msg.type !== "snapshot") {
			throw new CodecError("це не знімок");
		}
		return result.msg;
	},
	encodeInput: (seq, keys) => JSON.stringify(makeInput(seq, keys)),
	decodeInput: (data) => {
		const result = parseClientMessage(parseJson(data));
		if (!result.ok || result.msg.type !== "input") {
			throw new CodecError("це не input");
		}
		return result.msg;
	},
});
