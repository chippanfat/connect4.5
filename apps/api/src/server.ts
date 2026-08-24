import "dotenv/config";

import { createDatabase } from "@four/db";
import { toNodeHandler } from "better-auth/node";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import pinoHttp from "pino-http";
import { createClient } from "redis";
import { RedisStore } from "rate-limit-redis";

import { createAuth } from "./auth";
import { loadConfig } from "./config";
import { createEmailSender } from "./email";
import { createErrorHandler } from "./errors";
import { createGameRouter } from "./game-router";
import { GameService } from "./game-service";
import { createLogger } from "./logger";
import { createMetrics } from "./metrics";
import { createSocialRouter } from "./social-router";
import { SocialService } from "./social-service";
import { createGameSocket } from "./socket";

const WORKER_CHANNEL = "four:game-updates";

const config = loadConfig();
const logger = createLogger(config);
const metrics = createMetrics();
const { db, pool } = createDatabase(config.databaseUrl);
const redis = createClient({ url: config.redisUrl });
redis.on("error", (error) => logger.error({ err: error }, "Redis client error"));
await redis.connect();

const sendEmail = createEmailSender(config, logger);
const auth = createAuth(db, config, sendEmail);
const games = new GameService(db);
const social = new SocialService(db);
const app = express();
const httpServer = createServer(app);
const sockets = await createGameSocket(httpServer, {
  auth,
  config,
  games,
  social,
  logger,
  metrics,
  redis,
});

app.set("trust proxy", 1);
app.use(
  pinoHttp({
    logger,
    genReqId: (request, response) => {
      const requestId = request.headers["x-request-id"]?.toString() ?? randomUUID();
      response.setHeader("x-request-id", requestId);
      response.locals.requestId = requestId;
      return requestId;
    },
  }),
);
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "same-site" },
  }),
);
app.use(cors({ origin: config.appOrigin, credentials: true }));

const redisStore = new RedisStore({
  sendCommand: (...args: string[]) => redis.sendCommand(args),
  prefix: "rate:http:",
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.authRateLimit,
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStore,
  handler: (_request, response) =>
    response.status(429).json({
      ok: false,
      error: { code: "RATE_LIMITED", message: "Too many account requests. Try again shortly." },
    }),
});
const socialLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisStore({
    sendCommand: (...args: string[]) => redis.sendCommand(args),
    prefix: "rate:social:",
  }),
  handler: (_request, response) =>
    response.status(429).json({
      ok: false,
      error: { code: "RATE_LIMITED", message: "Too many social requests. Try again shortly." },
    }),
});
app.use("/api/auth", authLimiter);
app.all("/api/auth/*splat", toNodeHandler(auth));

app.use(express.json({ limit: "32kb" }));
app.use((request, response, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
    const origin = request.headers.origin;
    if (origin && origin !== config.appOrigin) {
      response.status(403).json({
        ok: false,
        error: { code: "FORBIDDEN", message: "This request origin is not allowed." },
      });
      return;
    }
  }
  next();
});
app.use(
  ["/api/users/search", "/api/friend-requests", "/api/game-invitations", "/api/games"],
  socialLimiter,
);

app.get("/health/live", (_request, response) => response.json({ status: "ok" }));
app.get("/health/ready", async (_request, response) => {
  try {
    await Promise.all([pool.query("select 1"), redis.ping()]);
    response.json({ status: "ready" });
  } catch (error) {
    logger.warn({ err: error }, "Readiness check failed");
    response.status(503).json({ status: "unavailable" });
  }
});
app.get("/metrics", async (_request, response) => {
  metrics.activeGames.set(await games.activeGameCount());
  response.type(metrics.registry.contentType).send(await metrics.registry.metrics());
});

app.use(
  "/api",
  createGameRouter({
    auth,
    config,
    games,
    broadcastGame: sockets.broadcastGame,
    broadcastAccount: sockets.broadcastAccount,
    notifyGameInvitation: sockets.notifyGameInvitation,
  }),
);
app.use(
  "/api",
  createSocialRouter({
    auth,
    social,
    appOrigin: config.appOrigin,
    sendEmail,
    broadcastGame: sockets.broadcastGame,
    broadcastAccount: sockets.broadcastAccount,
  }),
);
app.use(createErrorHandler(logger));

const updateSubscriber = redis.duplicate();
await updateSubscriber.connect();
await updateSubscriber.subscribe(WORKER_CHANNEL, async (message) => {
  try {
    const payload = JSON.parse(message) as {
      gameId: string;
      stateVersion: number;
      affectedUserIds?: string[];
    };
    const wonBroadcast = await redis.set(
      `broadcast:${payload.gameId}:${payload.stateVersion}`,
      "1",
      { NX: true, EX: 5 },
    );
    if (wonBroadcast) {
      await sockets.broadcastGame(payload.gameId);
      await Promise.all((payload.affectedUserIds ?? []).map(sockets.broadcastAccount));
    }
  } catch (error) {
    logger.error({ err: error }, "Unable to process a worker game update");
  }
});

httpServer.listen(config.port, () => {
  logger.info({ port: config.port, origin: config.appOrigin }, "Four in a Row API listening");
});

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  logger.info({ signal }, "Shutting down API");
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  await sockets.close();
  await updateSubscriber.quit();
  await redis.quit();
  await pool.end();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
