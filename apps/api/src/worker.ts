import "dotenv/config";

import { createDatabase } from "@four/db";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "redis";

import { loadConfig } from "./config";
import { GameService } from "./game-service";
import { createLogger } from "./logger";
import { createMetrics } from "./metrics";

const WORKER_CHANNEL = "four:game-updates";
const config = loadConfig();
const logger = createLogger(config);
const metrics = createMetrics();
const { db, pool } = createDatabase(config.databaseUrl);
const games = new GameService(db);
const redis = createClient({ url: config.redisUrl });
redis.on("error", (error) => logger.error({ err: error }, "Redis client error"));
await redis.connect();

const metricsServer = createServer(async (request, response) => {
  if (request.url === "/health/live") {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ status: "ok" }));
    return;
  }
  if (request.url === "/health/ready") {
    try {
      await Promise.all([pool.query("select 1"), redis.ping()]);
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ status: "ready" }));
    } catch {
      response.statusCode = 503;
      response.end(JSON.stringify({ status: "unavailable" }));
    }
    return;
  }
  if (request.url === "/metrics") {
    metrics.activeGames.set(await games.activeGameCount());
    response.setHeader("content-type", metrics.registry.contentType);
    response.end(await metrics.registry.metrics());
    return;
  }
  response.statusCode = 404;
  response.end("Not found");
});
metricsServer.listen(config.workerMetricsPort, () => {
  logger.info({ port: config.workerMetricsPort }, "Timeout worker metrics listening");
});

let running = true;
process.on("SIGINT", () => {
  running = false;
});
process.on("SIGTERM", () => {
  running = false;
});

logger.info("Turn-timeout worker started");
while (running) {
  try {
    const settled = await games.settleExpiredGames();
    const expiredInvites = await games.expireWaitingGames();
    for (const game of settled) {
      metrics.timeoutLag.observe(Math.max(0, (Date.now() - game.deadline.getTime()) / 1000));
      await redis.publish(
        WORKER_CHANNEL,
        JSON.stringify({ gameId: game.gameId, stateVersion: game.stateVersion }),
      );
    }
    for (const game of expiredInvites) {
      await redis.publish(WORKER_CHANNEL, JSON.stringify(game));
    }
  } catch (error) {
    logger.error({ err: error }, "Timeout worker pass failed");
  }
  await delay(250);
}

await redis.quit();
await pool.end();
await new Promise((resolve) => metricsServer.close(resolve));
logger.info("Turn-timeout worker stopped");
