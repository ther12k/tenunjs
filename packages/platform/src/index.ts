/**
 * @tenunjs/platform — platform capability seam contracts (TN-141).
 *
 * The contracts-first slice requested by the VOTOL consumer feedback:
 * freeze what an application binds to (ble / storage / camera — method
 * shapes, event shapes, failure taxonomy, permissions, degradation
 * states, cancellation) BEFORE the M5 implementations exist, because
 * seams written against a stable contract survive while apps written
 * against half-built internals get rewritten.
 *
 * Implementations are NOT here. M5 owns them: TN-097 (native-module IDL)
 * binds host manifests to CAPABILITY_CONTRACT_VERSION, TN-099/100 land
 * the reference modules. This package is the vocabulary both sides
 * compile against meanwhile.
 */
export {
  CAPABILITY_CONTRACT_VERSION,
  createCancelSource,
  fromAbortSignal,
  cancelledFailure,
  unsupportedFailure,
} from "./capability";
export type {
  CapabilityFailureKind,
  CapabilityFailure,
  CapabilityResult,
  CapabilityAvailability,
  CapabilityPlatform,
  PermissionPrerequisite,
  CapabilityCancelSignal,
  CapabilityCancelSource,
} from "./capability";
export { BLE_PERMISSIONS } from "./ble";
export type {
  BleLinkState,
  BleDevice,
  BleCharacteristicRef,
  BleNotification,
  BleScanOptions,
  BleScan,
  BleSessionOptions,
  BleWriteOptions,
  BleSession,
  BleCapability,
} from "./ble";
export { STORAGE_PERMISSIONS } from "./storage";
export type { StorageCapability } from "./storage";
export { CAMERA_PERMISSIONS } from "./camera";
export type { BarcodeFormat, BarcodeScan, CameraCapability } from "./camera";
export {
  defineHostCapabilities,
  unsupportedBle,
  unsupportedStorage,
  unsupportedCamera,
} from "./host";
export type { HostCapabilities, PartialHostCapabilities } from "./host";
