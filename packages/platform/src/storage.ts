/**
 * Key-value storage capability contract (TN-141).
 *
 * App-scoped sandbox: a capability instance addresses only the host's
 * storage for THIS application. Values are UTF-8 strings — codecs (JSON,
 * binary encodings) are application policy and stay out of the seam.
 * Hosts document size bounds through failure details, not the contract.
 *
 * Declares no manifest permissions on any tier: app-local storage needs
 * none on android, ios, or web. The empty table is stated explicitly so
 * permission tables stay total.
 */
import type {
  CapabilityAvailability,
  CapabilityResult,
  PermissionPrerequisite,
} from "./capability";

export const STORAGE_PERMISSIONS: readonly PermissionPrerequisite[] = [];

export interface StorageCapability {
  readonly contractVersion: 1;
  availability(): CapabilityAvailability;
  permissionPrerequisites(): readonly PermissionPrerequisite[];
  /** null = absent key. An empty key is invalid-argument. */
  get(key: string): Promise<CapabilityResult<string | null>>;
  set(key: string, value: string): Promise<CapabilityResult<void>>;
  remove(key: string): Promise<CapabilityResult<void>>;
  keys(): Promise<CapabilityResult<readonly string[]>>;
}
