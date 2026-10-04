/**
 * Host capability aggregate + the fail-closed default (TN-141).
 *
 * HostCapabilities is TOTAL by design: no optional members. A host that
 * lacks a capability passes the unsupported stub, so an application can
 * call any seam unconditionally and receive a structured failure — never
 * a silent no-op, never a crash on `undefined`. This generalizes the
 * `noPodHost` pattern the VOTOL example improvised (runtime.ts) into
 * framework-owned code, and gives TN-145's parity assertions a declared
 * surface to diff against.
 */
import type { CapabilityAvailability, CapabilityFailure, PermissionPrerequisite } from "./capability";
import { unsupportedFailure } from "./capability";
import type { BleCapability } from "./ble";
import { BLE_PERMISSIONS } from "./ble";
import type { StorageCapability } from "./storage";
import { STORAGE_PERMISSIONS } from "./storage";
import type { CameraCapability } from "./camera";
import { CAMERA_PERMISSIONS } from "./camera";

export interface HostCapabilities {
  readonly ble: BleCapability;
  readonly storage: StorageCapability;
  readonly camera: CameraCapability;
}

/** What a host actually implements; gaps become unsupported stubs. */
export type PartialHostCapabilities = Partial<HostCapabilities>;

const fail = (failure: CapabilityFailure) => Promise.resolve({ ok: false as const, failure });

export function unsupportedBle(reason?: string): BleCapability {
  return {
    contractVersion: 1,
    availability: () => ({ status: "unsupported", reason }),
    permissionPrerequisites: () => BLE_PERMISSIONS,
    scan: () => fail(unsupportedFailure("ble", reason)),
    connect: () => fail(unsupportedFailure("ble", reason)),
  };
}

export function unsupportedStorage(reason?: string): StorageCapability {
  return {
    contractVersion: 1,
    availability: () => ({ status: "unsupported", reason }),
    permissionPrerequisites: () => STORAGE_PERMISSIONS,
    get: () => fail(unsupportedFailure("storage", reason)),
    set: () => fail(unsupportedFailure("storage", reason)),
    remove: () => fail(unsupportedFailure("storage", reason)),
    keys: () => fail(unsupportedFailure("storage", reason)),
  };
}

export function unsupportedCamera(reason?: string): CameraCapability {
  return {
    contractVersion: 1,
    availability: () => ({ status: "unsupported", reason }),
    permissionPrerequisites: () => CAMERA_PERMISSIONS,
    scanBarcode: () => fail(unsupportedFailure("camera", reason)),
  };
}

/**
 * Composes a host's implemented capabilities with unsupported stubs for
 * the rest. Hosts build this once at boot and hand it to the
 * application's services context.
 */
export function defineHostCapabilities(
  implemented: PartialHostCapabilities,
  unsupportedReason?: string
): HostCapabilities {
  return {
    ble: implemented.ble ?? unsupportedBle(unsupportedReason),
    storage: implemented.storage ?? unsupportedStorage(unsupportedReason),
    camera: implemented.camera ?? unsupportedCamera(unsupportedReason),
  };
}
