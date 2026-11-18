// EventTarget із типізованими подіями. Карта Events: назва події → що лежить у detail.
// У lib.dom detail це any, тож вузьке місце одне: listen() віддає його як Events[K].
// Це безпечно, бо події створює лише emit(), який приймає саме Events[K].
export class TypedTarget<Events extends object> extends EventTarget {
	protected emit<K extends keyof Events & string>(
		type: K,
		detail: Events[K],
	): void {
		this.dispatchEvent(new CustomEvent(type, { detail }));
	}

	// підписка за назвою події; повертає функцію відписки
	listen<K extends keyof Events & string>(
		type: K,
		handler: (detail: Events[K]) => void,
	): () => void {
		const listener = (event: Event) => {
			if (event instanceof CustomEvent) handler(event.detail);
		};
		this.addEventListener(type, listener);
		return () => this.removeEventListener(type, listener);
	}
}
