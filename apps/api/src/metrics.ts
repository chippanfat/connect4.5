import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";

export function createMetrics() {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry, prefix: "four_" });

  const socketConnections = new Gauge({
    name: "four_socket_connections",
    help: "Current authenticated Socket.IO connections",
    registers: [registry],
  });
  const activeGames = new Gauge({
    name: "four_active_games",
    help: "Current waiting or active games",
    registers: [registry],
  });
  const gameCommands = new Counter({
    name: "four_game_commands_total",
    help: "Game commands received",
    labelNames: ["command", "result"] as const,
    registers: [registry],
  });
  const moveLatency = new Histogram({
    name: "four_move_duration_seconds",
    help: "Server-side move transaction latency",
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
    registers: [registry],
  });
  const timeoutLag = new Histogram({
    name: "four_timeout_lag_seconds",
    help: "Delay between a turn deadline and timeout settlement",
    buckets: [0.1, 0.25, 0.5, 1, 2, 5],
    registers: [registry],
  });

  return { registry, socketConnections, activeGames, gameCommands, moveLatency, timeoutLag };
}

export type Metrics = ReturnType<typeof createMetrics>;
