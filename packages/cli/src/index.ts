/**
 * @tenunjs/cli
 *
 * Developer CLI commands and workspace orchestration (TN-105, TN-106).
 */

export const CLI_VERSION = "0.1.0-alpha";

export interface CliCommand {
  name: string;
  description: string;
  run: (args: readonly string[]) => Promise<number> | number;
}

export const commands: Record<string, CliCommand> = {
  version: {
    name: "version",
    description: "Display TenunJS CLI version",
    run: () => {
      console.log(`tenun v${CLI_VERSION}`);
      return 0;
    },
  },
};
