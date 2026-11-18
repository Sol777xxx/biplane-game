// Створює елемент із властивостями й дітьми. Діти це рядки (стають текстовими вузлами) або
// вузли: чужий текст ніколи не потрапляє в DOM як HTML.
export function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	props: Partial<HTMLElementTagNameMap[K]> = {},
	...children: (string | Node)[]
): HTMLElementTagNameMap[K] {
	const node = Object.assign(document.createElement(tag), props);
	node.append(...children);
	return node;
}

// текст помилки з unknown (у catch і reject лежить що завгодно)
export const messageOf = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

// Елемент за селектором або зрозуміла помилка. kind це клас елемента (HTMLCanvasElement тощо):
// instanceof звужує тип без приведення, а відсутній або не той елемент дає помилку одразу.
export function query<T extends Element>(
	selector: string,
	kind: abstract new () => T,
): T {
	const node = document.querySelector(selector);
	if (!(node instanceof kind)) {
		throw new Error(`на сторінці немає потрібного елемента ${selector}`);
	}
	return node;
}
