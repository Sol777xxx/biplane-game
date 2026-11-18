import path from "node:path";
import { z } from "zod";

export class ConfigError extends Error {
	readonly problems: readonly string[];

	constructor(problems: readonly string[]) {
		super(`Некоректна конфігурація:\n - ${problems.join("\n - ")}`);
		this.name = "ConfigError";
		this.problems = problems;
	}
}

const ROOT = path.resolve(import.meta.dirname, "..", "..");

// Оточення це рядки або undefined. Схема перетворює їх на типізований Config:
// число стає числом, "1" стає true, відносні шляхи стають абсолютними.
const isPort = (s: string): boolean => /^\d+$/.test(s) && Number(s) <= 65535;
const isPositiveInt = (s: string): boolean => /^\d+$/.test(s) && Number(s) >= 1;

const envSchema = z
	.object({
		PORT: z.string().default("3000").refine(isPort).transform(Number),
		HOST: z
			.string()
			.default("127.0.0.1")
			.transform((s) => s.trim())
			.refine((s) => s.length > 0),
		MAX_ROOMS: z.string().default("50").refine(isPositiveInt).transform(Number),
		// /api/slow навмисно вантажить процес: вмикається лише явно
		ENABLE_SLOW: z
			.string()
			.optional()
			.transform((v) => v === "1"),
		// штучна затримка й втрати (?lag, ?jitter, ?loss у адресі сокета): теж лише явно
		ENABLE_NETSIM: z
			.string()
			.optional()
			.transform((v) => v === "1"),
		LOG_DIR: z.string().default("./logs"),
		CLIENT_DIR: z.string().optional(),
	})
	.transform((e) => ({
		port: e.PORT,
		host: e.HOST,
		maxRooms: e.MAX_ROOMS,
		enableSlow: e.ENABLE_SLOW,
		enableNetsim: e.ENABLE_NETSIM,
		// відносні шляхи рахуються від каталогу, з якого запущено сервер (server/)
		logDir: path.resolve(e.LOG_DIR),
		clientDir: path.resolve(e.CLIENT_DIR ?? path.join(ROOT, "client", "dist")),
	}));

// Тип конфігурації виводиться зі схеми: окремо його ніхто не описує.
export type Config = Readonly<z.output<typeof envSchema>>;

// Текст помилки для кожної змінної; схема каже лише «не пройшла», що саме не так, пояснюємо тут.
const PROBLEM: Readonly<Record<string, (raw: string) => string>> = {
	PORT: (raw) => `PORT має бути цілим числом 0–65535, отримано "${raw}"`,
	HOST: () => "HOST порожній",
	MAX_ROOMS: (raw) => `MAX_ROOMS має бути цілим числом ≥ 1, отримано "${raw}"`,
};

type Env = Readonly<Record<string, string | undefined>>;

// Читає й перевіряє оточення. Збирає всі помилки одразу, а не лише першу.
export function loadConfig(env: Env = process.env): Config {
	const parsed = envSchema.safeParse(env);
	if (parsed.success) return Object.freeze(parsed.data);

	const problems = new Set<string>();
	for (const issue of parsed.error.issues) {
		const key = String(issue.path[0] ?? "");
		const explain = PROBLEM[key];
		problems.add(
			explain
				? explain(env[key] ?? "")
				: `${key || "оточення"}: ${issue.message}`,
		);
	}
	throw new ConfigError([...problems]);
}
