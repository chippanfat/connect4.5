import { z } from "zod";

const ConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  WORKER_METRICS_PORT: z.coerce.number().int().positive().default(9091),
  APP_ORIGIN: z.string().url().default("http://localhost:5173"),
  DATABASE_URL: z.string().min(1).default("postgresql://four:four@localhost:5432/four"),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  AUTH_RATE_LIMIT: z.coerce.number().int().positive().default(60),
  BETTER_AUTH_SECRET: z.string().min(32).default("development-only-change-me-32-characters"),
  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  SMTP_REQUIRE_TLS: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  EMAIL_FROM: z.string().default("Four in a Row <play@localhost>"),
  EMAIL_REPLY_TO: z.string().email().default("play@example.test"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env) {
  const parsed = ConfigSchema.parse(environment);
  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    workerMetricsPort: parsed.WORKER_METRICS_PORT,
    appOrigin: parsed.APP_ORIGIN.replace(/\/$/, ""),
    databaseUrl: parsed.DATABASE_URL,
    redisUrl: parsed.REDIS_URL,
    authRateLimit: parsed.AUTH_RATE_LIMIT,
    authSecret: parsed.BETTER_AUTH_SECRET,
    smtp: {
      host: parsed.SMTP_HOST,
      port: parsed.SMTP_PORT,
      secure: parsed.SMTP_SECURE,
      requireTls: parsed.SMTP_REQUIRE_TLS,
      user: parsed.SMTP_USER,
      password: parsed.SMTP_PASSWORD,
      from: parsed.EMAIL_FROM,
      replyTo: parsed.EMAIL_REPLY_TO,
    },
    logLevel: parsed.LOG_LEVEL,
    isProduction: parsed.NODE_ENV === "production",
  } as const;
}
