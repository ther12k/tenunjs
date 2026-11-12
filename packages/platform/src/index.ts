/**
 * @tenunjs/platform — platform capability seam contracts (TN-141).
 *
 * The contracts-first slice requested by the VOTOL consumer feedback:
 * freeze what an application binds to (ble / storage / camera, plus the
 * TN-147 launcher seam — method shapes, event shapes, failure taxonomy,
 * permissions, degradation states, cancellation) BEFORE the M5
 * implementations exist, because
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
export { LAUNCHER_PERMISSIONS } from "./launcher";
export type {
  LauncherAppEntry,
  LauncherListOptions,
  LauncherLaunchOptions,
  LauncherCapability,
} from "./launcher";
export { NET_PERMISSIONS } from "./net";
export type {
  NetTlsOptions,
  NetConnectOptions,
  NetLinkState,
  NetSession,
  NetCapability,
} from "./net";
export { previewNetCapability, createFakeNetEndpoint } from "./net-preview";
export type { FakeNetServer } from "./net-preview";
export { createHostNetBridge, NET_EVENT_ACTION } from "./net-native";
export type { NetHostCall, HostNetBridge } from "./net-native";
export {
  MAX_NET_WRITE_BYTES,
  MAX_NET_TIMEOUT_MS,
  validNetHost,
  validNetPort,
  validNetTimeout,
  validCertSha256,
  validNetTlsOptions,
  netConnectArgumentError,
} from "./net-validation";
export { DISCOVERY_PERMISSIONS } from "./discovery";
export type {
  DiscoveredService,
  DiscoveryBrowse,
  ResolvedEndpoint,
  DiscoveryCapability,
} from "./discovery";
export { createHostDiscoveryBridge, DISCOVERY_EVENT_ACTION } from "./discovery-native";
export type { DiscoveryHostCall, HostDiscoveryBridge } from "./discovery-native";
export {
  MAX_SERVICE_NAME_BYTES,
  MAX_TXT_ENTRIES,
  MAX_TXT_VALUE_BYTES,
  validServiceType,
  validServiceName,
  validDiscoveryDomain,
  isDiscoveredService,
  discoveryBrowseArgumentError,
  validTxtRecord,
  utf8Length,
} from "./discovery-validation";
export { KEYS_PERMISSIONS } from "./keys";
export type { KeyHandle, KeyIdentity, KeysCapability } from "./keys";
export { previewKeyring } from "./keys-preview";
export type { PreviewKeysCapability } from "./keys-preview";
export { createHostKeysCapability } from "./keys-native";
export type { KeysHostCall } from "./keys-native";
export { validKeyAlias, validKeyData } from "./keys-validation";
export {
  defineHostCapabilities,
  unsupportedBle,
  unsupportedStorage,
  unsupportedCamera,
  unsupportedLauncher,
  unsupportedKeys,
  unsupportedNet,
  unsupportedDiscovery,
} from "./host";
export type { HostCapabilities, PartialHostCapabilities } from "./host";
