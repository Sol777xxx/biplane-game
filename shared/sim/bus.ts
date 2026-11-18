// Типізована шина поверх EventTarget: назва події визначає тип detail.
// E це карта «назва → detail» (див. BusEvents у types.ts). Старий API addEventListener
// лишається, бо клас успадковує EventTarget, але нові підписки робимо через on().

// Лише підписка: споживачам шини (звук, HUD, ефекти) emit не потрібен, тож вони просять
// саме цей інтерфейс і не залежать від того, хто шину створив.
export interface Subscribable<E extends object> {
	on<K extends keyof E & string>(
		type: K,
		listener: (detail: E[K]) => void,
	): () => void;
}

export class TypedBus<E extends object>
	extends EventTarget
	implements Subscribable<E>
{
	emit<K extends keyof E & string>(type: K, detail: E[K]): void {
		this.dispatchEvent(new CustomEvent(type, { detail }));
	}

	// повертає функцію відписки
	on<K extends keyof E & string>(
		type: K,
		listener: (detail: E[K]) => void,
	): () => void {
		const handler = (event: Event): void => {
			// emit завжди шле CustomEvent; instanceof звужує тип без приведення
			if (event instanceof CustomEvent) listener(event.detail);
		};
		this.addEventListener(type, handler);
		return () => this.removeEventListener(type, handler);
	}
}
