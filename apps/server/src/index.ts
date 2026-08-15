import open from "open";
import { buildApp } from "./app.js";

const built = await buildApp();

try {
  const address = await built.app.listen({ host: built.config.host, port: built.config.port });
  built.app.log.info({ address }, "Frase Uno Voice Foundry is ready");
  if (built.config.lanAccessEnabled) {
    if (built.access.lanUrls.length === 0) {
      built.app.log.warn("LAN access is enabled, but no private IPv4 network address was found.");
    } else {
      built.app.log.info({
        lanUrls: built.access.lanUrls,
        pairingCode: built.access.pairingCode,
      }, "LAN access enabled. Open a LAN URL on the iPhone and enter the per-run pairing code.");
    }
  }
  if (built.config.openBrowser && built.config.nodeEnv !== "test") {
    await open(`http://127.0.0.1:${built.config.port}`, { wait: false });
  }
} catch (error) {
  built.app.log.error(error);
  process.exitCode = 1;
  await built.app.close();
}

const shutdown = async (): Promise<void> => {
  await built.app.close();
};

process.once("SIGINT", () => { void shutdown(); });
process.once("SIGTERM", () => { void shutdown(); });

export { buildApp } from "./app.js";
