import type { Biplane } from "./biplane.ts";
import type { Seq } from "./ids.ts";
import type { Bullet, Obstacle, Pickup, PickupType } from "./objects.ts";
import type { Vec2 } from "./vector.ts";

// Усі види сутностей симуляції. Поле kind різне в кожного класу, тому
// `if (e.kind === "biplane")` звужує тип до Biplane: це дискримінантне об'єднання.
export type SimEntity = Biplane | Bullet | Obstacle | Pickup;
export type SimKind = SimEntity["kind"];

// Стан вводу одного кроку; seq додає сервер або клієнт, коли крок відповідає справжньому input.
export interface InputState {
	readonly up?: boolean;
	readonly down?: boolean;
	readonly left?: boolean;
	readonly right?: boolean;
	readonly fire?: boolean;
	readonly seq?: Seq;
}

// Черга подій кроку (World.events): її читає й очищає Game.
export type SimEvent =
	| { readonly type: "hit"; readonly at: Vec2; readonly target: SimEntity }
	| {
			readonly type: "destroyed";
			readonly entity: SimEntity;
			readonly by: SimEntity | null;
	  }
	| {
			readonly type: "crash";
			readonly entity: SimEntity;
			readonly other: SimEntity;
	  }
	| { readonly type: "pickup"; readonly entity: Pickup; readonly by: Biplane };

export type ExplosionColor = "storm" | "pink";

// Шина світу: назва події → що лежить у detail. Підписники (звук, HUD, ефекти)
// отримують типізований detail і не можуть переплутати назву з вмістом.
export interface BusEvents {
	fired: {
		readonly by: { readonly playerId?: string | null };
		readonly at: Vec2;
	};
	hit: { readonly at: Vec2; readonly target: { readonly kind: SimKind } };
	crash: { readonly player: string | null; readonly at: Vec2 };
	scored: {
		readonly player: string;
		readonly delta: number;
		readonly total: number;
		readonly at: Vec2;
	};
	pickup: {
		readonly type: PickupType;
		readonly by: { readonly playerId?: string | null };
		readonly player: string | null;
	};
	exploded: {
		readonly kind: SimKind;
		readonly pos: Vec2;
		readonly size: number;
		readonly color: ExplosionColor;
		readonly count: number;
	};
	respawned: { readonly player: string; readonly at: Vec2 };
}
