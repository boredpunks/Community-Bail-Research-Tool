import { createRequire } from "node:module";

const require = createRequire(new URL("../lib/db/package.json", import.meta.url));
const { Pool } = require("pg");

const jobId = process.argv[2] ?? "";
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) {
  process.stderr.write("A valid job UUID is required.\n");
  process.exit(2);
}
if (!process.env.DATABASE_URL) {
  process.stderr.write("The configured database is unavailable.\n");
  process.exit(2);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  connectionTimeoutMillis: 10_000,
});

try {
  const { rows } = await pool.query(
    `SELECT
       id::text AS item_id,
       position,
       docket_number,
       source_url,
       provenance->'matchingEvents' AS matching_events,
       provenance->>'courtOffice' AS office,
       provenance->>'courtRoom' AS courtroom
     FROM discovery_items
     WHERE job_id = $1::uuid
     ORDER BY position`,
    [jobId],
  );
  process.stdout.write(JSON.stringify(rows));
} catch {
  process.stderr.write("Failed to read the saved discovery rows.\n");
  process.exitCode = 1;
} finally {
  await pool.end();
}
