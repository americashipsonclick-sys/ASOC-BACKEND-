import EmbeddedPostgres from "embedded-postgres";
import path from "node:path";

const dataDir = path.join(process.cwd(), "data", "pg");

async function main() {
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "asoc",
    password: "asoc",
    port: 5432,
    persistent: true,
  });

  await pg.initialise();
  await pg.start();
  try {
    await pg.createDatabase("asoc");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/already exists/i.test(message)) throw err;
  }

  console.log("Postgres ready at postgres://asoc:asoc@localhost:5432/asoc");
  console.log("Leave this process running. Ctrl+C to stop.");

  const stop = async () => {
    await pg.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  await new Promise(() => {});
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
