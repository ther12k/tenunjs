/** TN-189 device fixture: compile the PUBLIC adapter, never a bridge facsimile. */
import {
  createHostKeysCapability,
  type CapabilityResult,
  type KeysHostCall,
} from "@tenunjs/platform";

const host = globalThis as typeof globalThis & {
  tenun_host_call?: unknown;
  Buffer?: unknown;
  atob?: unknown;
  btoa?: unknown;
  __tenun_dispatch_action?: (action: string, payloadJson: string) => string;
};

function isHostCall(value: unknown): value is KeysHostCall {
  return typeof value === "function";
}

const hostCall = host.tenun_host_call;
if (!isHostCall(hostCall)) throw new Error("keys fixture requires the native host bridge");
const keys = createHostKeysCapability(hostCall);
let completed: string | undefined;

function start<T>(operation: Promise<CapabilityResult<T>>, normalize: (value: T) => unknown): string {
  completed = undefined;
  // JNI accepts a synchronous string, NOT a Promise. Its pending-job drain
  // runs these continuations; a subsequent synchronous dispatch reads them.
  void operation.then(
    (result) => {
      completed = JSON.stringify(result.ok ? { ok: true, value: normalize(result.value) } : result);
    },
    (error: unknown) => {
      completed = JSON.stringify({ fixtureError: String(error) });
    },
  );
  return JSON.stringify({ pending: true });
}

host.__tenun_dispatch_action = (action, payloadJson) => {
  if (action === "result") return completed ?? JSON.stringify({ pending: true });
  if (action === "metadata") {
    return JSON.stringify({
      contractVersion: keys.contractVersion,
      availability: keys.availability(),
      permissions: keys.permissionPrerequisites(),
      globals: { Buffer: typeof host.Buffer, atob: typeof host.atob, btoa: typeof host.btoa },
    });
  }
  const payload = JSON.parse(payloadJson) as { alias: string; handle: string; data: number[] };
  switch (action) {
    case "generateIdentity":
      return start(keys.generateIdentity(payload.alias), (identity) => identity);
    case "sign":
      return start(keys.sign(payload.handle, new Uint8Array(payload.data)), (bytes) => Array.from(bytes));
    case "exportCertificatePem":
      return start(keys.exportCertificatePem(payload.handle), (pem) => pem);
    case "removeIdentity":
      return start(keys.removeIdentity(payload.handle), () => null);
    default:
      throw new Error(`unknown keys fixture action: ${action}`);
  }
};
