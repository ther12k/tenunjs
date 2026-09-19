import type { ScreenDefinition } from "@tenunjs/core";
import type { WidgetNode } from "@tenunjs/jsx-runtime";
import { showcaseTheme } from "../flutter-showcase/src/theme";
import { LauncherScreen } from "../flutter-showcase/src/screens/launcher.screen";
import { IntroScreen } from "../flutter-showcase/src/screens/intro.screen";
import { HotelScreen } from "../flutter-showcase/src/screens/hotel.screen";
import { FitnessShowcaseScreen } from "../flutter-showcase/src/screens/fitness.screen";
import { CourseScreen } from "../flutter-showcase/src/screens/course.screen";
import { NavigationStudyScreen } from "../flutter-showcase/src/screens/navigation.screen";
import {
  SHOWCASE_APPS,
  isShowcaseAppId,
  type ShowcaseAppId,
} from "../flutter-showcase/src/data";
import { layoutScreen, type DisplayListScene } from "../ui-kit/src/display-list";

type AnyScreen = ScreenDefinition<any, any>;
type Action = (input?: unknown) => void;

/** Internal screen registry. "home" is the launcher surface. */
const screens: Record<string, AnyScreen> = {
  home: LauncherScreen as AnyScreen,
  intro: IntroScreen as AnyScreen,
  hotel: HotelScreen as AnyScreen,
  fitness: FitnessShowcaseScreen as AnyScreen,
  course: CourseScreen as AnyScreen,
  navigation: NavigationStudyScreen as AnyScreen,
};

const LAUNCHER = "home";

/**
 * Schema 2 splits the flat route snapshot into host state (which surface is
 * frontmost) plus per-app session state. Bump only with an explicit
 * migration; restore() still accepts schema-1 snapshots.
 */
export const STATE_SCHEMA = 2;

/**
 * A restorable state value must be a plain object — every screen state is
 * one. Anything else (string, number, array, null) is treated as malformed
 * snapshot data and the session mounts fresh instead of crashing or
 * mutating garbage.
 */
function asRestorableState(value: unknown): unknown {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : undefined;
}

export type ShowcaseSurface = "launcher" | "app";

export interface ShowcaseSnapshot {
  stateSchema: number;
  surface: ShowcaseSurface;
  appId: ShowcaseAppId | null;
  launcherState: unknown;
  appStates: Partial<Record<ShowcaseAppId, unknown>>;
}

export interface ShowcaseRender {
  scene: DisplayListScene;
  tapRuns: Array<() => void>;
}

interface Session {
  readonly name: string;
  readonly state: any;
  readonly actions: Record<string, Action>;
}

/**
 * Launcher host adapter for the flutter-showcase screens. Two state layers:
 *
 *  - Host state: which surface is front (launcher or an app) and which app
 *    is active. The launcher screen itself is a session too, so "last
 *    opened" survives app transitions.
 *  - App sessions: one lazily mounted session per app id, each owning its
 *    real controller state and typed actions. closeApp() hides the app but
 *    keeps the session, so reopening resumes exactly where the user left
 *    off — the native home-screen metaphor.
 *
 * Only the launcher or the active app renders at a time; screens still
 * provide their real initialState(), action handlers, and view(). There are
 * no browser, Canvas, Android, or navigation-host globals here.
 */
export class ShowcaseRuntime {
  private surface: ShowcaseSurface = "launcher";
  private activeApp: ShowcaseAppId | null = null;
  private launcherSession: Session;
  private readonly appSessions = new Map<ShowcaseAppId, Session>();
  private tapRuns: Array<() => void> = [];

  constructor() {
    this.launcherSession = this.mount(LAUNCHER);
  }

  isLauncher(): boolean {
    return this.surface === "launcher";
  }

  /** Active app id, or null while the launcher is frontmost. */
  activeAppId(): ShowcaseAppId | null {
    return this.isLauncher() ? null : this.activeApp;
  }

  /** Launcher catalog metadata for host chrome (labels, accents, icons). */
  apps() {
    return SHOWCASE_APPS;
  }

  /**
   * Flat route name for hosts that speak the old contract: "home" on the
   * launcher, otherwise the active app id.
   */
  route(): string {
    return this.isLauncher() ? LAUNCHER : this.activeApp!;
  }

  routes(): string[] {
    return [LAUNCHER, ...SHOWCASE_APPS.map((app) => app.id)];
  }

  /** Opens an app session (mounting it once) and brings it to the front. */
  openApp(id: ShowcaseAppId): void {
    if (!isShowcaseAppId(id)) return;
    if (!this.appSessions.has(id)) this.appSessions.set(id, this.mount(id));
    this.activeApp = id;
    this.surface = "app";
  }

  /**
   * Returns to the launcher. The active app's session stays mounted, so its
   * state survives until restore replaces it.
   */
  closeApp(): void {
    this.surface = "launcher";
    this.activeApp = null;
  }

  /**
   * Compatibility alias for the pre-launcher host contract: "home" closes
   * the active app; an app id opens/resumes it; unknown names are ignored.
   */
  navigate(name: string): void {
    if (name === LAUNCHER) {
      this.closeApp();
      return;
    }
    this.openApp(name as ShowcaseAppId);
  }

  render(): ShowcaseRender {
    const session = this.isLauncher()
      ? this.launcherSession
      : (this.appSessions.get(this.activeApp as ShowcaseAppId) ??
        this.mount(this.activeApp as ShowcaseAppId));
    if (!this.isLauncher()) {
      this.appSessions.set(this.activeApp as ShowcaseAppId, session);
    }
    const screen = screens[session.name]!;
    const tree = screen.view({ state: session.state, actions: session.actions }) as WidgetNode;
    const { scene, tapRuns } = layoutScreen(showcaseTheme, tree);

    // Host contract for app surfaces: the first region is a generic
    // back-to-launcher affordance, so hosts never need screen knowledge.
    // The launcher has no such region — it is the frontmost surface.
    if (!this.isLauncher()) {
      scene.taps.unshift({
        x: 0,
        y: 0,
        w: scene.designWidth,
        h: 96,
        action: "tap",
        payload: { id: tapRuns.length },
      });
      tapRuns.push(() => this.closeApp());
    }

    this.tapRuns = tapRuns;
    return { scene, tapRuns };
  }

  dispatch(action: string, payload: unknown = {}): void {
    const normalized = action.toUpperCase();
    if (normalized === "TAP") {
      const id = typeof payload === "number" ? payload : (payload as { id?: unknown })?.id;
      if (typeof id === "number") this.tapRuns[id]?.();
      return;
    }
    if (normalized === "NAVIGATE" || normalized === "ROUTE") {
      const route = typeof payload === "string" ? payload : (payload as { route?: unknown })?.route;
      if (typeof route === "string") this.navigate(route);
      return;
    }
    if (normalized === "OPEN_APP") {
      const id = typeof payload === "string" ? payload : (payload as { id?: unknown })?.id;
      if (typeof id === "string") this.openApp(id as ShowcaseAppId);
      return;
    }
    if (normalized === "CLOSE_APP") {
      this.closeApp();
      return;
    }
    if (normalized === "__TENUN_EXPORT" || normalized === "__TENUN_STATE_SCHEMA") return;
    if (normalized === "TENUN_RESTORE" || normalized === "__TENUN_RESTORE" || normalized === "RESTORE") {
      this.restore(payload as Partial<ShowcaseSnapshot>);
    }
  }

  exportState(): ShowcaseSnapshot {
    const appStates: Partial<Record<ShowcaseAppId, unknown>> = {};
    for (const [id, session] of this.appSessions) appStates[id] = session.state;
    return {
      stateSchema: STATE_SCHEMA,
      surface: this.surface,
      appId: this.activeAppId(),
      launcherState: this.launcherSession.state,
      appStates,
    };
  }

  stateSchema(): number {
    return STATE_SCHEMA;
  }

  /**
   * Restores the current schema-2 snapshot, or migrates a schema-1 flat
   * snapshot ({ route, states }) by mapping states.home to the launcher and
   * every other known screen key to its app session.
   *
   * Failure semantics (deliberate, never a throw): a snapshot from a NEWER
   * schema resets to a fresh launcher instead of being guessed at; unknown
   * app ids and malformed (non-object) state entries are ignored so that
   * study mounts fresh.
   */
  restore(snapshot: Partial<ShowcaseSnapshot> & { route?: unknown; states?: unknown }): void {
    const legacy = snapshot as { stateSchema?: unknown; states?: Record<string, unknown>; route?: unknown };
    if (
      typeof legacy.stateSchema === "number" &&
      legacy.stateSchema > STATE_SCHEMA
    ) {
      // Future snapshot shape: identification is not validation. Reset
      // deliberately rather than restore a guess.
      this.launcherSession = this.mount(LAUNCHER);
      this.appSessions.clear();
      this.closeApp();
      return;
    }
    if (typeof legacy.stateSchema !== "number" || legacy.stateSchema < 2) {
      this.restoreLegacy(legacy);
      return;
    }
    if (snapshot.launcherState !== undefined) {
      this.launcherSession = this.mount(LAUNCHER, asRestorableState(snapshot.launcherState));
    }
    const appStates = (snapshot.appStates ?? {}) as Record<string, unknown>;
    for (const key of Object.keys(appStates)) {
      if (isShowcaseAppId(key)) {
        this.appSessions.set(key, this.mount(key, asRestorableState(appStates[key])));
      }
    }
    if (snapshot.surface === "app" && snapshot.appId && isShowcaseAppId(snapshot.appId)) {
      this.openApp(snapshot.appId);
    } else {
      this.closeApp();
    }
  }

  private restoreLegacy(snapshot: { states?: Record<string, unknown>; route?: unknown }): void {
    const states = snapshot.states;
    if (states && typeof states === "object" && !Array.isArray(states)) {
      if (states[LAUNCHER] !== undefined) {
        this.launcherSession = this.mount(LAUNCHER, asRestorableState(states[LAUNCHER]));
      }
      for (const key of Object.keys(states)) {
        if (isShowcaseAppId(key)) {
          this.appSessions.set(key, this.mount(key, asRestorableState(states[key])));
        }
      }
    }
    if (typeof snapshot.route === "string") {
      if (isShowcaseAppId(snapshot.route)) this.openApp(snapshot.route);
      else if (snapshot.route === LAUNCHER) this.closeApp();
    }
  }

  private mount(name: string, restoredState?: unknown): Session {
    const screen = screens[name]!;
    const controller = "controller" in screen ? screen.controller : screen;
    const state = restoredState !== undefined ? restoredState : controller.initialState();
    const isLauncher = name === LAUNCHER;
    const actions: Record<string, Action> = {};

    for (const key of Object.keys(controller.actions)) {
      actions[key] = (input?: unknown) => {
        const handler = (controller.actions as Record<string, unknown>)[key] as any;
        const context = {
          input,
          state,
          services: {},
          signal: undefined as unknown as AbortSignal,
        };
        if (typeof handler === "function") handler(context);
        else handler.run(context);

        // The launcher's typed `open(appId)` action owns its display state
        // (last opened, drawer); the host adapter additionally promotes that
        // selection into an app-session transition.
        if (
          isLauncher &&
          (key === "open" || key === "navigate") &&
          typeof input === "string" &&
          isShowcaseAppId(input)
        ) {
          this.openApp(input);
        }
      };
    }

    return { name, state, actions };
  }
}
