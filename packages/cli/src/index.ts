/**
 * @tenunjs/cli
 *
 * Developer CLI commands and workspace orchestration (TN-105, TN-106).
 */

export {
  CONFIG_VERSION,
  TenunConfigError,
  defineConfig,
  loadConfig,
} from "./config";
export type {
  ConfigDiagnostic,
  ConfigLoadResult,
  Platform,
  TenunConfig,
  TenunConfigErrorCode,
  TenunConfigInput,
} from "./config";

export {
  GRAPH_VERSION,
  ModuleGraphError,
  buildApplicationGraph,
} from "./module-graph";
export type {
  ApplicationGraph,
  AssetRecord,
  EdgeKind,
  GraphBuildOptions,
  GraphDiagnostic,
  ModuleRecord,
  ResolvedImport,
} from "./module-graph";

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
