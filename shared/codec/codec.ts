import type { InputMessage, SnapshotMessage } from "../protocol/index.ts";
import type { Seq } from "../sim/ids.ts";

// Помилка розбору кадру: кодек кидає лише її, а не TypeError чи RangeError.
export class CodecError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CodecError";
	}
}

// Те, що приходить з мережі: текст (JSON) або байти.
export type Frame = string | ArrayBuffer | Uint8Array;

// Стан клавіш «як є»: типів тут свідомо немає, makeInput і кодувальник самі беруть п'ять булевих.
export type KeysLike = Readonly<Record<string, unknown>> | null | undefined;

// Спільний інтерфейс кодеків. Out це те, що кодек віддає в мережу.
interface CodecBase<Out> {
	readonly name: string;
	encodeSnapshot(msg: SnapshotMessage): Out;
	decodeSnapshot(data: Frame): SnapshotMessage;
	encodeInput(seq: Seq, keys: KeysLike): Out;
	decodeInput(data: Frame): InputMessage;
}

export interface TextCodec extends CodecBase<string> {
	readonly isBinary: false;
}

export interface BinaryCodec extends CodecBase<Uint8Array> {
	readonly isBinary: true;
}

// isBinary це дискримінант: перевірив його, і tsc знає, string чи Uint8Array в encode.
export type Codec = TextCodec | BinaryCodec;
