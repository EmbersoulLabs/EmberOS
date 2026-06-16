import "dotenv/config";
import { startWorkers } from "./processors/index";

startWorkers();

process.on("SIGTERM", () => {
  console.log("Shutting down workers...");
  process.exit(0);
});
