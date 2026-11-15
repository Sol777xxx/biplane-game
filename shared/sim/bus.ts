// Типізована шина поверх EventTarget: назва події визначає тип detail.
// E це карта «назва → detail» (див. BusEvents у types.ts). Старий API addEventListener
// лишається, бо клас успадковує EventTarget, але нові підписки робимо через on().
export class TypedBus<E extends object> extends EventTarget {
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
