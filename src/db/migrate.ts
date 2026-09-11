import { migrate, closePool } from "./pool";

migrate()
  .then(() => closePool())
  .then(() => {
    console.log("database ready");
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
