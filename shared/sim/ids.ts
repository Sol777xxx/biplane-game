// Branded-типи: у рантаймі це звичайні числа, але TypeScript не дає передати один
// вид числа туди, де чекають інший (id сутності замість seq, крок замість id тощо).
declare const brand: unique symbol;
export type Brand<T, Name extends string> = T & { readonly [brand]: Name };

export type EntityId = Brand<number, "EntityId">;
export type Tick = Brand<number, "Tick">;
export type Seq = Brand<number, "Seq">;

// seq вміщується в Uint32 (у бінарному форматі це 4 байти)
export const MAX_SEQ = 0xffffffff;

// Захисники типів: єдине місце, де звичайне число стає branded. Без `as`.
export const isEntityId = (n: number): n is EntityId =>
	Number.isSafeInteger(n) && n >= 0;
export const isTick = (n: number): n is Tick =>
	Number.isSafeInteger(n) && n >= 0;
export const isSeq = (n: number): n is Seq =>
	Number.isSafeInteger(n) && n >= 0 && n <= MAX_SEQ;

export function toEntityId(n: number): EntityId {
	if (!isEntityId(n))
		throw new RangeError(`EntityId: невід'ємне ціле, отримано ${n}`);
	return n;
}

export function toTick(n: number): Tick {
	if (!isTick(n)) throw new RangeError(`Tick: невід'ємне ціле, отримано ${n}`);
	return n;
}

export function toSeq(n: number): Seq {
	if (!isSeq(n)) throw new RangeError(`Seq: ціле 0–${MAX_SEQ}, отримано ${n}`);
	return n;
}

// 0 в обох випадках означає «немає»: сутність ще не додано у світ, input ще не було
export const NO_ENTITY: EntityId = toEntityId(0);
export const NO_SEQ: Seq = toSeq(0);
