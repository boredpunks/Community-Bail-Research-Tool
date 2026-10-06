import app from "./app";
import { logger } from "./lib/logger";
import { startDiscoveryWorker } from "./lib/discovery-worker";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  void startDiscoveryWorker();
});

for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => {
  server.close();
  // Child/source traffic is stopped by the worker's signal handler. Recovery
  // retains uncertain request slots rather than silently sending them again.
  setTimeout(() => process.exit(0), 1500).unref();
});
