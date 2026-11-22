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
// Origin це схема + хост (+ порт) без шляху й слеша наприкінці: саме так його шле браузер
const isOrigin = (s: string): boolean => {
	try {
		return new URL(s).origin === s;
	} catch {
		return false;
	}
};
const csv = (s: string): string[] =>
	s
		.split(",")
		.map((part) => part.trim())
		.filter(Boolean);

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
		// Origin, яким дозволено відкривати сокет, через кому. Порожньо: лише той самий хост.
		ALLOWED_ORIGINS: z
			.string()
			.default("")
			.transform(csv)
			.pipe(z.array(z.string().refine(isOrigin))),
		// ліміти процесу: одночасних з'єднань з однієї IP і гравців у всіх кімнатах разом
		MAX_CONN_PER_IP: z
			.string()
			.default("20")
			.refine(isPositiveInt)
			.transform(Number),
		MAX_PLAYERS: z
			.string()
			.default("200")
			.refine(isPositiveInt)
			.transform(Number),
		// IP клієнта з X-Forwarded-For: вмикаємо лише за проксі хостингу
		TRUST_PROXY: z
			.string()
			.optional()
			.transform((v) => v === "1"),
		LOG_LEVEL: z
			.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
			.default("info"),
		// git SHA збірки: його кладе в образ CI, /health показує його
		GIT_SHA: z
			.string()
			.default("dev")
			.transform((s) => s.trim() || "dev"),
	})
	.transform((e) => ({
		port: e.PORT,
		host: e.HOST,
		maxRooms: e.MAX_ROOMS,
		enableSlow: e.ENABLE_SLOW,
		enableNetsim: e.ENABLE_NETSIM,
		allowedOrigins: e.ALLOWED_ORIGINS,
		maxConnPerIp: e.MAX_CONN_PER_IP,
		maxPlayers: e.MAX_PLAYERS,
		trustProxy: e.TRUST_PROXY,
		logLevel: e.LOG_LEVEL,
		gitSha: e.GIT_SHA,
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
	MAX_CONN_PER_IP: (raw) =>
		`MAX_CONN_PER_IP має бути цілим числом ≥ 1, отримано "${raw}"`,
	MAX_PLAYERS: (raw) =>
		`MAX_PLAYERS має бути цілим числом ≥ 1, отримано "${raw}"`,
	ALLOWED_ORIGINS: (raw) =>
		`ALLOWED_ORIGINS: через кому, кожен у вигляді https://хост[:порт] без слеша наприкінці, отримано "${raw}"`,
	LOG_LEVEL: (raw) =>
		`LOG_LEVEL: fatal, error, warn, info, debug, trace або silent, отримано "${raw}"`,
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
