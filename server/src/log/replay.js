import { createReadStream } from "node:fs";
import { Readable } from "node:stream";

const MAX_LINE = 1024 * 1024; // рядок довший за 1 МБ це не наш лог

// Ріже потік на рядки. Працює з рядковими шматками (encoding: "utf8"): декодер сам
// склеює багатобайтовий символ, розрізаний межею шматків.
export async function* readLines(stream) {
	let rest = "";
	for await (const chunk of stream) {
		const parts = (rest + chunk).split("\n");
		rest = parts.pop(); // хвіст без \n чекає на наступний шматок
		for (const line of parts) yield line;
		if (rest.length > MAX_LINE) throw new RangeError("рядок логу задовгий");
	}
	if (rest) yield rest; // останній рядок міг лишитись без \n
}

// Події з файлу по одній. У пам'яті лише поточний шматок (64 КБ) і недочитаний рядок.
// onBadLine(lineNo, error): якщо задано, битий рядок пропускається (наприклад, обрізаний
// аварією останній), інакше кидається SyntaxError із номером рядка.
export async function* readEvents(
	file,
	{ signal, highWaterMark = 64 * 1024, onBadLine } = {},
) {
	const stream = createReadStream(file, {
		encoding: "utf8",
		highWaterMark,
		signal,
	});
	let lineNo = 0;
	try {
		for await (const line of readLines(stream)) {
			lineNo++;
			if (line.trim() === "") continue;
			let event;
			try {
				event = JSON.parse(line);
			} catch (error) {
				if (!onBadLine)
					throw new SyntaxError(`рядок ${lineNo}: ${error.message}`);
				onBadLine(lineNo, error);
				continue;
			}
			yield event;
		}
	} finally {
		stream.destroy(); // дострокове завершення циклу не лишає відкритий файл
	}
}

// те саме як Readable в об'єктному режимі, щоб підключати до pipeline
export const replayStream = (file, options) =>
	Readable.from(readEvents(file, options));
