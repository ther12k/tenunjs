import { describe, expect, test } from "bun:test";
import { CLI_VERSION, commands } from "../src/index";

describe("@tenunjs/cli", () => {
  test("exposes CLI version", () => {
    expect(CLI_VERSION).toBe("0.1.0-alpha");
  });

  test("contains version command", async () => {
    expect(commands.version).toBeDefined();
    expect(commands.version.name).toBe("version");
    const code = await commands.version.run([]);
    expect(code).toBe(0);
  });
});
