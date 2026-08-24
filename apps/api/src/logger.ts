import pino from "pino";

import type { AppConfig } from "./config";

export function createLogger(config: AppConfig) {
  return pino({
    level: config.logLevel,
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "res.headers.set-cookie",
        "password",
        "token",
      ],
      censor: "[redacted]",
    },
  });
}

export type AppLogger = ReturnType<typeof createLogger>;
