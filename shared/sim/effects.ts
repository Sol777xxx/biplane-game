// Ефекти корабля (секунд, що лишилось). Те саме ім'я має бонус, який його дає.
export type EffectName = "shield" | "rapid" | "homing";
export type Effects = Record<EffectName, number>;

// порядок важливий: за ним оновлюються ефекти й вибирається бонус
export const EFFECT_NAMES: readonly EffectName[] = [
	"shield",
	"rapid",
	"homing",
];
