import { describe, expect, test } from "bun:test";
import {
  CAPABILITY_CONTRACT_VERSION,
  CAMERA_PERMISSIONS,
  STORAGE_PERMISSIONS,
  BLE_PERMISSIONS,
  createCancelSource,
  defineHostCapabilities,
  fromAbortSignal,
  type BleCapability,
  type CapabilityAvailability,
  type CapabilityFailureKind,
  type HostCapabilities,
  type StorageCapability,
} from "../src/index";

/**
 * TN-141 contract-freeze tests. Three properties must hold forever:
 *  1. FAIL-CLOSED — an unimplemented capability is callable and returns a
 *     structured `unsupported` failure; never a silent no-op, never a
 *     throw, never a fabricated success.
 *  2. QUICKJS-SAFE — cancellation works with the platform AbortController
 *     deleted (the recorded TN-133 slice-2 device-failure class).
 *  3. FROZEN VOCABULARY — the failure kinds, availability statuses, and
 *     permission tables are pinned; changing them is a contract-version
 *     decision, not an edit.
 */

/** Fixture: a real storage implementation typed against the contract. */
function inMemoryStorage(): StorageCapability {
  const store = new Map<string, string>();
  return {
    contractVersion: 1,
    availability: () => ({ status: "supported" }),
    permissionPrerequisites: () => STORAGE_PERMISSIONS,
    async get(key) {
      if (key === "") return { ok: false, failure: { kind: "invalid-argument" } };
      return { ok: true, value: store.get(key) ?? null };
    },
    async set(key, value) {
      if (key === "") return { ok: false, failure: { kind: "invalid-argument" } };
      store.set(key, value);
      return { ok: true, value: undefined };
    },
    async remove(key) {
      store.delete(key);
      return { ok: true, value: undefined };
    },
    async keys() {
      return { ok: true, value: [...store.keys()].sort() };
    },
  };
}

/**
 * Fixture: a BLE capability whose scan stays pending until cancelled —
 * proves a host can honor the signal WITHOUT any Web API existing.
 */
function cancellableScanBle(): BleCapability {
  return {
    contractVersion: 1,
    availability: () => ({ status: "supported" }),
    permissionPrerequisites: () => BLE_PERMISSIONS,
    scan(options) {
      return new Promise((resolve) => {
        if (options.serviceUuids.length === 0) {
          resolve({ ok: false, failure: { kind: "invalid-argument", message: "empty uuid filter" } });
          return;
        }
        const off = options.signal?.addAbortListener(() => {
          resolve({ ok: false, failure: { kind: "cancelled" } });
        });
        // keep `off` referenced: a real host stops its radio here
        void off;
      });
    },
    async connect() {
      return { ok: false, failure: { kind: "unavailable", reason: "fixture" } };
    },
  };
}

describe("TN-141 fail-closed host defaults", () => {
  const host: HostCapabilities = defineHostCapabilities({}, "test host: nothing bound");

  test("the aggregate is total — every capability is callable, none undefined", () => {
    expect(host.ble).toBeDefined();
    expect(host.storage).toBeDefined();
    expect(host.camera).toBeDefined();
  });

  test("every storage operation returns a structured unsupported failure", async () => {
    for (const result of [
      await host.storage.get("k"),
      await host.storage.set("k", "v"),
      await host.storage.remove("k"),
      await host.storage.keys(),
    ]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.failure.kind).toBe("unsupported");
    }
  });

  test("ble and camera operations fail the same way — never a throw, never ok", async () => {
    const scan = await host.ble.scan({ serviceUuids: ["0000fff0-0000-1000-8000-00805f9b34fb"] });
    expect(scan.ok).toBe(false);
    if (!scan.ok) expect(scan.failure.kind).toBe("unsupported");

    const connected = await host.ble.connect({ deviceId: "x" });
    expect(connected.ok).toBe(false);

    const shot = await host.camera.scanBarcode(["qr"]);
    expect(shot.ok).toBe(false);
    if (!shot.ok) expect(shot.failure.kind).toBe("unsupported");
  });

  test("availability reports the degradation state with the host's reason", () => {
    expect(host.storage.availability()).toEqual({
      status: "unsupported",
      reason: "test host: nothing bound",
    });
  });

  test("permission tables describe the capability, so even stubs expose them", () => {
    expect(host.ble.permissionPrerequisites()).toBe(BLE_PERMISSIONS);
    expect(host.storage.permissionPrerequisites()).toEqual([]);
  });

  test("implemented capabilities pass through untouched", async () => {
    const partial = defineHostCapabilities({ storage: inMemoryStorage() });
    expect(await partial.storage.set("pod.key", "32hex")).toEqual({ ok: true, value: undefined });
    expect(await partial.storage.get("pod.key")).toEqual({ ok: true, value: "32hex" });
    expect(await partial.storage.keys()).toEqual({ ok: true, value: ["pod.key"] });
    expect(await partial.storage.remove("pod.key")).toEqual({ ok: true, value: undefined });
    expect(await partial.storage.get("pod.key")).toEqual({ ok: true, value: null });

    const ble = await partial.ble.scan({ serviceUuids: ["x"] });
    expect(ble.ok).toBe(false); // gap stays fail-closed
  });

  test("an implementing host may enforce contract validation (empty keys)", async () => {
    const storage = inMemoryStorage();
    const result = await storage.get("");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe("invalid-argument");
  });
});

describe("TN-141 QuickJS-safe cancellation", () => {
  // The recorded device-failure class: QuickJS ships no AbortController.
  // Delete the global (as the widgets regression does) and prove the
  // contract still works end to end.
  const hasNativeAbort = typeof AbortController === "function";
  const SavedAbortController: (typeof AbortController) | undefined = hasNativeAbort
    ? AbortController
    : undefined;

  test("createCancelSource works with AbortController deleted from the realm", () => {
    const globalAny = globalThis as { AbortController?: unknown };
    delete globalAny.AbortController;

    try {
      const source = createCancelSource();
      expect(source.aborted).toBe(false);

      let fires = 0;
      const off = source.addAbortListener(() => {
        fires += 1;
      });

      source.cancel("user navigated away");
      expect(source.aborted).toBe(true);
      expect(source.reason).toBe("user navigated away");
      expect(fires).toBe(1);

      source.cancel("again"); // idempotent: listeners fire once
      expect(fires).toBe(1);

      off();
      const late = createCancelSource();
      late.cancel("already gone");
      let lateFires = 0;
      late.addAbortListener(() => {
        lateFires += 1;
      }); // subscribing AFTER abort fires immediately
      expect(lateFires).toBe(1);
      expect(late.reason).toBe("already gone");
    } finally {
      if (SavedAbortController !== undefined) globalAny.AbortController = SavedAbortController;
    }
  });

  test("an in-flight capability operation honors the signal and resolves cancelled", async () => {
    const globalAny = globalThis as { AbortController?: unknown };
    delete globalAny.AbortController;
    try {
      const ble = cancellableScanBle();
      const signal = createCancelSource();
      const pending = ble.scan({ serviceUuids: ["fff0"], signal });
      signal.cancel();
      const result = await pending;
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.failure.kind).toBe("cancelled");
    } finally {
      if (SavedAbortController !== undefined) globalAny.AbortController = SavedAbortController;
    }
  });

  test("fromAbortSignal adapts a platform signal the caller holds (never constructs one)", () => {
    const controller = new AbortController();
    const signal = fromAbortSignal(controller.signal);
    expect(signal.aborted).toBe(false);

    let fired = 0;
    const off = signal.addAbortListener(() => {
      fired += 1;
    });
    controller.abort();
    expect(signal.aborted).toBe(true);
    expect(fired).toBe(1);
    off();

    const preAborting = new AbortController();
    preAborting.abort();
    const preAborted = fromAbortSignal(preAborting.signal);
    expect(preAborted.aborted).toBe(true);
    let immediate = 0;
    preAborted.addAbortListener(() => {
      immediate += 1;
    });
    expect(immediate).toBe(1);
  });
});

describe("TN-141 frozen vocabulary (contract freeze evidence)", () => {
  test("the capability contract version is 1", () => {
    expect(CAPABILITY_CONTRACT_VERSION).toBe(1);
  });

  test("the failure alphabet is exactly the nine frozen kinds", () => {
    const kinds: readonly CapabilityFailureKind[] = [
      "unsupported",
      "denied",
      "unavailable",
      "busy",
      "timeout",
      "cancelled",
      "invalid-argument",
      "link-lost",
      "platform-error",
    ];
    // Compile-time exhaustiveness + runtime pin: a change to the union is
    // a contract-version decision.
    const exhaustive: Record<CapabilityFailureKind, true> = {
      unsupported: true,
      denied: true,
      unavailable: true,
      busy: true,
      timeout: true,
      cancelled: true,
      "invalid-argument": true,
      "link-lost": true,
      "platform-error": true,
    };
    expect(Object.keys(exhaustive).sort()).toEqual([...kinds].sort());
  });

  test("the availability statuses are exactly the four degradation states", () => {
    const statuses: CapabilityAvailability["status"][] = [
      "supported",
      "unsupported",
      "denied",
      "unavailable",
    ];
    const pin: Record<CapabilityAvailability["status"], true> = {
      supported: true,
      unsupported: true,
      denied: true,
      unavailable: true,
    };
    expect(Object.keys(pin).sort()).toEqual([...statuses].sort());
  });

  test("BLE permissions encode the Android S+ split, the legacy location tier, and iOS", () => {
    expect(BLE_PERMISSIONS).toEqual([
      {
        platform: "android",
        osSince: 31,
        permissions: ["android.permission.BLUETOOTH_SCAN", "android.permission.BLUETOOTH_CONNECT"],
      },
      { platform: "android", osUntil: 30, permissions: ["android.permission.ACCESS_FINE_LOCATION"] },
      { platform: "ios", permissions: ["NSBluetoothAlwaysUsageDescription"] },
      { platform: "web", permissions: [] },
    ]);
  });

  test("camera declares its two manifest permissions; storage declares none (app-scoped)", () => {
    expect(CAMERA_PERMISSIONS).toEqual([
      { platform: "android", permissions: ["android.permission.CAMERA"] },
      { platform: "ios", permissions: ["NSCameraUsageDescription"] },
      { platform: "web", permissions: [] },
    ]);
    expect(STORAGE_PERMISSIONS).toEqual([]);
  });
});
