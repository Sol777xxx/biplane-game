export interface Logger {
	info(...args: unknown[]): void;
	warn(...args: unknown[]): void;
	error(...args: unknown[]): void;
}

const stamp = (): string => new Date().toISOString();

export const consoleLogger: Logger = {
	info: (...args) => console.log(stamp(), "INFO ", ...args),
	warn: (...args) => console.warn(stamp(), "WARN ", ...args),
	error: (...args) => console.error(stamp(), "ERROR", ...args),
};

// для тестів
export const silentLogger: Logger = { info() {}, warn() {}, error() {} };
