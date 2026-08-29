import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";

const app = createApp();

app.listen(env.PORT, "0.0.0.0", () => {
  logger.info({ port: env.PORT, host: "0.0.0.0" }, "HTTP server listening");
});
