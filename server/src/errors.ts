// Помилки Node (ENOENT, ERR_STREAM_PREMATURE_CLOSE) мають поле code. У catch помилка це unknown,
// тож спершу перевіряємо, що це Error із полем code, а не звертаємось до error.code навмання.
export function hasCode(error: unknown, code: string): boolean {
	return error instanceof Error && "code" in error && error.code === code;
}
