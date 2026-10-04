/**
 * BLE GATT client capability contract (TN-141).
 *
 * Shape proven by the VOTOL phone build (2026-10-02 consumer feedback,
 * gap 2): scan-with-UUID-filter → connect → write + notify with the CCC
 * descriptor programmed by the host, plus the push-driven link-state
 * machine (offline / searching / linked) a companion app renders.
 *
 * Host mappings:
 *  - Android: BLE scan (API-31 split below), BluetoothGatt session.
 *  - Web: `requestDevice` inside scan() — the picker is the scan; it
 *    emits exactly one device, then the scan stops. connect() then uses
 *    the deviceId the picker produced.
 * UUID strings compare case-insensitively; hosts expose lowercase.
 */
import type {
  CapabilityAvailability,
  CapabilityCancelSignal,
  CapabilityResult,
  PermissionPrerequisite,
} from "./capability";

/** Static truth for codegen and docs; hosts surface it via the capability. */
export const BLE_PERMISSIONS: readonly PermissionPrerequisite[] = [
  {
    platform: "android",
    osSince: 31,
    permissions: ["android.permission.BLUETOOTH_SCAN", "android.permission.BLUETOOTH_CONNECT"],
  },
  { platform: "android", osUntil: 30, permissions: ["android.permission.ACCESS_FINE_LOCATION"] },
  { platform: "ios", permissions: ["NSBluetoothAlwaysUsageDescription"] },
  { platform: "web", permissions: [] },
];

/** Companion-app link machine the UI renders (never a boolean). */
export type BleLinkState = "offline" | "searching" | "linked";

export interface BleDevice {
  /** Host-opaque id, stable within one host run. */
  readonly deviceId: string;
  readonly name: string | null;
  /** UUIDs the device advertised for the scan's filter (lowercase). */
  readonly serviceUuids: readonly string[];
  readonly rssi?: number;
}

export interface BleCharacteristicRef {
  readonly serviceUuid: string;
  readonly characteristicUuid: string;
}

export interface BleNotification {
  readonly characteristic: BleCharacteristicRef;
  readonly data: Uint8Array;
}

export interface BleScanOptions {
  /** Canonical UUID strings; an empty list fails closed with invalid-argument. */
  readonly serviceUuids: readonly string[];
  readonly signal?: CapabilityCancelSignal;
}

/** A live scan: event-driven, caller-stopped. */
export interface BleScan {
  onDeviceDiscovered(listener: (device: BleDevice) => void): () => void;
  /** Idempotent; after stop no further discoveries are delivered. */
  stop(): void;
}

export interface BleSessionOptions {
  readonly signal?: CapabilityCancelSignal;
  readonly timeoutMs?: number;
}

export interface BleWriteOptions {
  readonly signal?: CapabilityCancelSignal;
  /** Default true: acknowledge writes; false allows fire-and-forget. */
  readonly withResponse?: boolean;
}

export interface BleSession {
  readonly device: BleDevice;
  /** Services are discovered as part of connect; writes address by UUID pair. */
  write(
    characteristic: BleCharacteristicRef,
    data: Uint8Array,
    options?: BleWriteOptions
  ): Promise<CapabilityResult<void>>;
  /**
   * Subscribe to notifications/indications; the host programs the CCC
   * descriptor. The RESULT value is the unsubscribe function (idempotent);
   * a failure means no subscription was established.
   */
  subscribeNotifications(
    characteristics: readonly BleCharacteristicRef[],
    listener: (notification: BleNotification) => void
  ): Promise<CapabilityResult<() => void>>;
  /** Push-driven link reality (the seam TN-142 delivers into the runtime). */
  onLinkStateChange(listener: (state: BleLinkState) => void): () => void;
  /** Idempotent; afterwards pending calls resolve link-lost or cancelled. */
  disconnect(): void;
}

export interface BleCapability {
  readonly contractVersion: 1;
  availability(): CapabilityAvailability;
  permissionPrerequisites(): readonly PermissionPrerequisite[];
  scan(options: BleScanOptions): Promise<CapabilityResult<BleScan>>;
  connect(device: Pick<BleDevice, "deviceId">, options?: BleSessionOptions): Promise<CapabilityResult<BleSession>>;
}
