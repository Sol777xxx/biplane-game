const stamp = () => new Date().toISOString();

export const consoleLogger = {
	info: (...args) => console.log(stamp(), "INFO ", ...args),
	warn: (...args) => console.warn(stamp(), "WARN ", ...args),
	error: (...args) => console.error(stamp(), "ERROR", ...args),
};

// для тестів
export const silentLogger = { info() {}, warn() {}, error() {} };
