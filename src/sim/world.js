import { findCollisions } from "./collision.js";

export class World {
	#entities = new Map(); // id -> Entity
	events = []; // події кроку; їх читає Game

	spawn(entity) {
		entity.world = this;
		this.#entities.set(entity.id, entity);
		return entity;
	}

	// відкладене видалення: лише позначка, sweep наприкінці кроку
	despawn(id) {
		const entity = this.#entities.get(id);
		if (entity) entity.alive = false;
	}

	get(id) {
		return this.#entities.get(id);
	}

	get size() {
		return this.#entities.size;
	}

	count(kind) {
		let n = 0;
		for (const e of this.ofKind(kind)) {
			if (e.alive) n++;
		}
		return n;
	}

	*[Symbol.iterator]() {
		yield* this.#entities.values();
	}

	// генератор: віддає сутності одного виду по одній
	*ofKind(kind) {
		for (const e of this) {
			if (e.kind === kind) yield e;
		}
	}

	// inputs: Map<id сутності, стан вводу>
	step(dt, inputs = new Map()) {
		// знімок: сутності, додані під час кроку, оновляться з наступного
		for (const e of [...this]) {
			if (e.alive) e.update(dt, inputs.get(e.id));
		}

		for (const [a, b] of findCollisions(this)) {
			if (!a.alive || !b.alive) continue;
			a.onCollide(b);
			b.onCollide(a);
		}

		this.#sweep();
	}

	#sweep() {
		for (const [id, e] of this.#entities) {
			if (!e.alive) this.#entities.delete(id);
		}
	}
}
