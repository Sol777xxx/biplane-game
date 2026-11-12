import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	INPUT_KEYS,
	inputFromMessage,
	MAX_SEQ,
	MSG,
	make,
	makeInput,
	PROTOCOL_VERSION,
} from "../protocol/index.js";

describe("shared/protocol", () => {
	it("make додає версію", () => {
		assert.deepEqual(make("ping", { t: 1 }), {
			v: PROTOCOL_VERSION,
			type: "ping",
			t: 1,
		});
	});

	it("makeInput: усі ключі булеві, зайве відкидається", () => {
		const msg = makeInput(3, { right: 1, fire: "так", turn: 99 });
		assert.deepEqual(msg, {
			v: 1,
			type: "input",
			seq: 3,
			up: false,
			down: false,
			left: false,
			right: true,
			fire: true,
		});
	});

	it("inputFromMessage віддає лише ключі вводу", () => {
		const keys = inputFromMessage(makeInput(9, { up: true }));
		assert.deepEqual(keys, {
			up: true,
			down: false,
			left: false,
			right: false,
			fire: false,
		});
	});

	it("повідомлення переживає JSON", () => {
		const msg = makeInput(42, { left: true, fire: true });
		assert.deepEqual(JSON.parse(JSON.stringify(msg)), msg);
	});

	it("константи заморожені, seq вміщується в Uint32", () => {
		assert.ok(Object.isFrozen(MSG));
		assert.ok(Object.isFrozen(INPUT_KEYS));
		assert.throws(() => INPUT_KEYS.push("x"), TypeError);
		assert.equal(MAX_SEQ, 2 ** 32 - 1);
	});
});
