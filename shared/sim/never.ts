// Ставимо в default кожного switch по type або kind. Якщо додати новий варіант
// і забути його обробити, значення в default перестане бути never, і tsc дасть помилку.
// У рантаймі сюди потрапляє лише дані, що обійшли типи (наприклад, з мережі).
export function assertNever(value: never, what = "значення"): never {
	throw new Error(`Необроблений варіант: ${what} ${String(value)}`);
}
