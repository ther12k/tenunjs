/**
 * Launcher/app-drawer capability contract (TN-147).
 *
 * The seam a launcher-shaped application binds to: enumerate the
 * device's launchable apps and start one. Frozen with the same
 * contracts-first policy as TN-141 (shape before implementation), so
 * the M5 host modules (Android PackageManager binding, browser/test
 * doubles) compile against a stable vocabulary.
 *
 * Host mappings:
 *  - Android: listApps() enumerates activities with a
 *    CATEGORY_HOME-launchable intent via PackageManager; launch(appId)
 *    startActivityes the launch intent for the package. App visibility
 *    on API 30+ needs either the broad QUERY_ALL_PACKAGES grant this
 *    contract's permission table declares (the maximum manifest-level
 *    grant; Play permits it for launcher-role apps) or a targeted
 *    `<queries>` block for the launchable intent — hosts document which
 *    they ship. launch() is exempt from visibility: starting an app by
 *    package works without either grant.
 *  - Web/iOS: unsupported stubs (no installable-app enumeration).
 *
 * Icon policy: v1 carries a unicode `iconGlyph` the host picked (an
 * initial monogram or emoji), because the display-list scene has text,
 * not bitmaps. `appId` is the stable key a future image/icon widget
 * kind can resolve against; the contract does not promise pixels.
 */
import type {
  CapabilityAvailability,
  CapabilityCancelSignal,
  CapabilityResult,
  PermissionPrerequisite,
} from "./capability";

/** Static truth for codegen and docs; hosts surface it via the capability. */
export const LAUNCHER_PERMISSIONS: readonly PermissionPrerequisite[] = [
  // The broad grant. Hosts may instead ship a targeted <queries> block
  // (launchable-intent visibility) and report availability supported;
  // the table declares the maximum the capability can require.
  { platform: "android", permissions: ["android.permission.QUERY_ALL_PACKAGES"] },
  { platform: "ios", permissions: [] },
  { platform: "web", permissions: [] },
];

/** One launchable app exactly as a drawer renders it. */
export interface LauncherAppEntry {
  /**
   * Host-opaque id, stable within one host run. On Android the package
   * name; the value hosts echo back into launch().
   */
  readonly appId: string;
  /** Display label (localized by the host, not the app). */
  readonly label: string;
  /**
   * Host-picked unicode glyph for v1 monogram rendering; null when the
   * host has none (apps render a fallback glyph app-side).
   */
  readonly iconGlyph: string | null;
}

export interface LauncherListOptions {
  readonly signal?: CapabilityCancelSignal;
}

export interface LauncherLaunchOptions {
  readonly signal?: CapabilityCancelSignal;
}

export interface LauncherCapability {
  readonly contractVersion: 1;
  availability(): CapabilityAvailability;
  permissionPrerequisites(): readonly PermissionPrerequisite[];
  /** Launchable apps in host order (commonly label-sorted). */
  listApps(options?: LauncherListOptions): Promise<CapabilityResult<readonly LauncherAppEntry[]>>;
  /** Starts the app; ok:true means the host handed off, not that the
   *  app reached any particular screen. */
  launch(appId: string, options?: LauncherLaunchOptions): Promise<CapabilityResult<void>>;
}
