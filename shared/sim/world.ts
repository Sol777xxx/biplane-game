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

const NO_INPUTS: ReadonlyMap<EntityId, InputState | undefined> = new Map();
const NONE: readonly never[] = [];

// видалення мертвих зі збереженням порядку, без нового масиву
function compact(list: Entity[]): void {
	let w = 0;
	for (let r = 0; r < list.length; r++) {
		const e = list[r];
		if (e?.alive) list[w++] = e;
	}
	list.length = w;
}

export class World implements EntityWorld, Iterable<Entity> {
	#entities = new Map<EntityId, Entity>(); // id -> Entity
	// Порядок створення тримаємо в масивах: усі сутності й окремо за видами. Раніше ofKind і
	// ітерація світу були генераторами, і кожен next() створював об'єкт результату:
	// найбільший алокатор клієнта після щита (лаб 7, профіль «after1»). Порядок у масивах
	// збігається з порядком вставки в Map, тож хеш симуляції не змінюється.
	#list: Entity[] = [];
	#byKind = new Map<string, Entity[]>();
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
		this.#list.push(entity);
		const bucket = this.#byKind.get(entity.kind);
		if (bucket) bucket.push(entity);
		else this.#byKind.set(entity.kind, [entity]);
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

	[Symbol.iterator](): Iterator<Entity> {
		return this.#list[Symbol.iterator]();
	}

	// Сутності одного виду в порядку створення. Це живий масив світу, а не копія: читати
	// можна, міняти ні, а щоб вижити після step(), його треба скопіювати ([...world.ofKind(k)]).
	// Сутності, створені під час обходу, у кінці масиву й потраплять у цей же обхід.
	ofKind<K extends string>(kind: K): readonly OfKind<K>[] {
		// у кошику лежать лише сутності цього виду (spawn кладе за entity.kind),
		// тож звуження типу тут безпечне; поелементна перевірка коштувала б O(n) на виклик
		return (this.#byKind.get(kind) ?? NONE) as readonly OfKind<K>[];
	}

	// inputs: Map<id сутності, стан вводу>
	step(
		dt: number,
		inputs: ReadonlyMap<EntityId, InputState | undefined> = NO_INPUTS,
	): void {
		// n зафіксовано до циклу: сутності, додані під час кроку, лежать далі й оновляться
		// з наступного кроку. Копія масиву для цього не потрібна.
		const list = this.#list;
		for (let i = 0, n = list.length; i < n; i++) {
			const e = list[i];
			if (e?.alive) e.update(dt, inputs.get(e.id));
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
		let dead = false;
		for (const e of this.#list) {
			if (!e.alive) {
				dead = true;
				this.#entities.delete(e.id);
				e.recycle();
			}
		}
		if (!dead) return;
		compact(this.#list);
		for (const bucket of this.#byKind.values()) compact(bucket);
	}
}
