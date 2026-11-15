import { TypedBus } from "./bus.ts";
import { findCollisions } from "./collision.ts";
import type { Entity, EntityWorld } from "./entity.ts";
import { type EntityId, toEntityId } from "./ids.ts";
import type {
	BusEvents,
	InputState,
	SimEntity,
	SimEvent,
	SimKind,
} from "./types.ts";

// Для відомого виду віддаємо його клас (ofKind("obstacle") це Obstacle),
// для чужого (частинки клієнта) звичайний Entity цього виду.
type OfKind<K extends string> = string extends K
	? Entity // вид невідомий на етапі компіляції
	: [Extract<SimEntity, { kind: K }>] extends [never]
		? Entity<K>
		: Extract<SimEntity, { kind: K }>;

// Єдине місце, де рядок kind стає типом: клас сутності визначається її kind.
function isKind<K extends string>(e: Entity, kind: K): e is OfKind<K> {
	return e.kind === kind;
}

const SIM_KINDS: ReadonlySet<string> = new Set<SimKind>([
	"biplane",
	"bullet",
	"obstacle",
	"pickup",
]);

// Колізії обробляють лише сутності симуляції; частинки й вибухи клієнта радіуса не мають.
export function isSimEntity(e: Entity): e is SimEntity {
	return SIM_KINDS.has(e.kind);
}

export class World implements EntityWorld, Iterable<Entity> {
	#entities = new Map<EntityId, Entity>(); // id -> Entity
	#nextId = 1; // id видає світ: клієнт і сервер рахують однаково
	readonly events: SimEvent[] = []; // події кроку; їх читає Game
	// шина для відв'язаних підписників (audio, HUD): сим їх не імпортує
	readonly bus = new TypedBus<BusEvents>();

	emit<K extends keyof BusEvents>(type: K, detail: BusEvents[K]): void {
		this.bus.emit(type, detail);
	}

	spawn<E extends Entity>(entity: E): E {
		entity.world = this;
		entity.id = toEntityId(this.#nextId++);
		this.#entities.set(entity.id, entity);
		return entity;
	}

	// відкладене видалення: лише позначка, sweep наприкінці кроку
	despawn(id: EntityId): void {
		const entity = this.#entities.get(id);
		if (entity) entity.alive = false;
	}

	get(id: EntityId): Entity | undefined {
		return this.#entities.get(id);
	}

	get size(): number {
		return this.#entities.size;
	}

	count(kind: string): number {
		let n = 0;
		for (const e of this.ofKind(kind)) {
			if (e.alive) n++;
		}
		return n;
	}

	*[Symbol.iterator](): Generator<Entity> {
		yield* this.#entities.values();
	}

	// генератор: віддає сутності одного виду по одній
	*ofKind<K extends string>(kind: K): Generator<OfKind<K>> {
		for (const e of this) {
			if (isKind(e, kind)) yield e;
		}
	}

	// inputs: Map<id сутності, стан вводу>
	step(
		dt: number,
		inputs: ReadonlyMap<EntityId, InputState | undefined> = new Map(),
	): void {
		// знімок: сутності, додані під час кроку, оновляться з наступного
		for (const e of [...this]) {
			if (e.alive) e.update(dt, inputs.get(e.id));
		}

		for (const [a, b] of findCollisions(this)) {
			if (!a.alive || !b.alive) continue;
			if (!isSimEntity(a) || !isSimEntity(b)) continue;
			a.onCollide(b);
			b.onCollide(a);
		}

		this.#sweep();
	}

	#sweep(): void {
		for (const [id, e] of this.#entities) {
			if (!e.alive) this.#entities.delete(id);
		}
	}
}
