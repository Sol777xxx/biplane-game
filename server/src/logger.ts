import { inspect } from "node:util";
import pino from "pino";

// Інтерфейс лишився тим, що був: сервер викликає log.info("текст"). Новий лише child():
// він додає поля (room, player) до кожного запису. Тестові логери його можуть не мати,
// тому користуємось childLogger().
export interface Logger {
	info(...args: unknown[]): void;
	warn(...args: unknown[]): void;
	error(...args: unknown[]): void;
	child?(bindings: Record<string, unknown>): Logger;
}

export function childLogger(
	log: Logger,
	bindings: Record<string, unknown>,
): Logger {
	return log.child?.(bindings) ?? log;
}

// Аргументи виклику в запис: Error іде в поле err (pino розгортає його в type/message/stack),
// простий об'єкт зливається в поля запису, решта складається в рядок повідомлення.
// Приклад: log.warn({ ip, reason }, "відхилено") або log.error("збій:", error).
function split(args: readonly unknown[]): {
	fields: Record<string, unknown>;
	msg: string;
} {
	const fields: Record<string, unknown> = {};
	const text: string[] = [];
	for (const arg of args) {
		if (arg instanceof Error) fields.err = arg;
		else if (typeof arg === "string") text.push(arg);
		else if (typeof arg === "object" && arg !== null && !Array.isArray(arg)) {
			Object.assign(fields, arg);
		} else text.push(inspect(arg));
	}
	return { fields, msg: text.join(" ") };
}

// Паролі й ключі не мають потрапляти в логи. Ми їх і не логуємо, redact це друга лінія
// оборони: якщо хтось колись допише в запис об'єкт із такими полями, значення сховається.
const REDACT = [
	"password",
	"token",
	"secret",
	"apiKey",
	"authorization",
	"*.password",
	"*.token",
	"*.secret",
	"*.apiKey",
	"*.authorization",
	"req.headers.cookie",
];

// Кореневий pino: один JSON-рядок на запис у stdout. Запис синхронний (sync: true):
// перед process.exit() нічого не лишається в буфері, тож останній рядок не губиться.
export function createRootLogger(
	level = "info",
	destination: pino.DestinationStream = pino.destination({
		dest: 1,
		sync: true,
	}),
): pino.Logger {
	return pino(
		{
			level,
			base: { service: "biplane" },
			timestamp: pino.stdTimeFunctions.isoTime,
			formatters: { level: (label) => ({ level: label }) },
			redact: { paths: REDACT, censor: "[redacted]" },
		},
		destination,
	);
}

export function fromPino(root: pino.Logger): Logger {
	const at =
		(level: "info" | "warn" | "error") =>
		(...args: unknown[]): void => {
			const { fields, msg } = split(args);
			root[level](fields, msg);
		};
	return {
		info: at("info"),
		warn: at("warn"),
		error: at("error"),
		child: (bindings) => fromPino(root.child(bindings)),
	};
}

// Логер за замовчуванням для тестів і розробки: читабельний текст, без pino.
const stamp = (): string => new Date().toISOString();

function consoleWith(bindings: Record<string, unknown>): Logger {
	const ctx = Object.keys(bindings).length ? [JSON.stringify(bindings)] : [];
	return {
		info: (...args) => console.log(stamp(), "INFO ", ...ctx, ...args),
		warn: (...args) => console.warn(stamp(), "WARN ", ...ctx, ...args),
		error: (...args) => console.error(stamp(), "ERROR", ...ctx, ...args),
		child: (more) => consoleWith({ ...bindings, ...more }),
	};
}

export const consoleLogger: Logger = consoleWith({});

// для тестів
export const silentLogger: Logger = { info() {}, warn() {}, error() {} };
