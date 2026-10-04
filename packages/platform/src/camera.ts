/**
 * Camera barcode-scan capability contract (TN-141).
 *
 * One-shot scan: the host owns presentation (full-screen scanner,
 * viewfinder, or whatever the platform idiom is) and resolves with the
 * first decode matching the requested formats. Continuous scanning is
 * deliberately NOT in the minimal contract — no consumer of record
 * needed it, and it drags in surface lifecycle that belongs to a later
 * slice.
 */
import type {
  CapabilityAvailability,
  CapabilityCancelSignal,
  CapabilityResult,
  PermissionPrerequisite,
} from "./capability";

export const CAMERA_PERMISSIONS: readonly PermissionPrerequisite[] = [
  { platform: "android", permissions: ["android.permission.CAMERA"] },
  { platform: "ios", permissions: ["NSCameraUsageDescription"] },
  { platform: "web", permissions: [] },
];

export type BarcodeFormat =
  | "qr"
  | "data-matrix"
  | "pdf-417"
  | "aztec"
  | "code-128"
  | "code-39"
  | "ean-13"
  | "ean-8"
  | "upc-a"
  | "upc-e"
  | "itf";

export interface BarcodeScan {
  readonly format: BarcodeFormat;
  readonly value: string;
}

export interface CameraCapability {
  readonly contractVersion: 1;
  availability(): CapabilityAvailability;
  permissionPrerequisites(): readonly PermissionPrerequisite[];
  /** An empty formats list fails closed with invalid-argument. */
  scanBarcode(
    formats: readonly BarcodeFormat[],
    options?: { readonly signal?: CapabilityCancelSignal }
  ): Promise<CapabilityResult<BarcodeScan>>;
}
