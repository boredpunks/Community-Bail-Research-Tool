import app from "./app";
import { logger } from "./lib/logger";
import { startDiscoveryWorker } from "./lib/discovery-worker";
import { startBailSearchWorker } from "./services/bail-search-worker";

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
  void startBailSearchWorker().then(() => startDiscoveryWorker()).catch(error => logger.error({ err: error }, "Discovery worker stopped"));
});

for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => {
  server.close();
  setTimeout(() => process.exit(0), 1500).unref();
});
