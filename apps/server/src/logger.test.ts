import { describe, expect, it } from "vitest";
import { redactSecrets } from "./logger.js";

describe("secret redaction", () => {
  it("redacts secret keys and embedded known values recursively", () => {
    const secret = "sk_private_value_1234";
    const result = redactSecrets({
      apiKey: secret,
      nested: { message: `provider rejected ${secret}`, Authorization: `Bearer ${secret}` },
      list: [secret],
    }, [secret]);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(result).toEqual({
      apiKey: "[REDACTED]",
      nested: { message: "provider rejected [REDACTED]", Authorization: "[REDACTED]" },
      list: ["[REDACTED]"],
    });
  });
});
