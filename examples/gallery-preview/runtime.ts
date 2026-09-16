import type { ScreenDefinition } from "@tenunjs/core";
import type { WidgetNode } from "@tenunjs/jsx-runtime";
import { galleryTheme } from "../gallery/src/theme";
import { HomeScreen } from "../gallery/src/screens/home.screen";
import { BankingScreen } from "../gallery/src/screens/banking.screen";
import { SmartHomeScreen } from "../gallery/src/screens/smart-home.screen";
import { FitnessScreen } from "../gallery/src/screens/fitness.screen";
import { StoreScreen } from "../gallery/src/screens/store.screen";
import { SettingsScreen } from "../gallery/src/screens/settings.screen";
import { WeatherScreen } from "../gallery/src/screens/weather.screen";
import { MusicScreen } from "../gallery/src/screens/music.screen";
import { ChatScreen } from "../gallery/src/screens/chat.screen";
import { RecipesScreen } from "../gallery/src/screens/recipes.screen";
import { CryptoScreen } from "../gallery/src/screens/crypto.screen";
import { ViewsScreen } from "../gallery/src/screens/views.screen";
import { layoutScreen, type DisplayListScene } from "../ui-kit/src/display-list";

type AnyScreen = ScreenDefinition<any, any>;
type Action = (input?: unknown) => void;

const screens: Record<string, AnyScreen> = {
  home: HomeScreen as AnyScreen,
  views: ViewsScreen as AnyScreen,
  banking: BankingScreen as AnyScreen,
  smartHome: SmartHomeScreen as AnyScreen,
  fitness: FitnessScreen as AnyScreen,
  store: StoreScreen as AnyScreen,
  settings: SettingsScreen as AnyScreen,
  weather: WeatherScreen as AnyScreen,
  music: MusicScreen as AnyScreen,
  chat: ChatScreen as AnyScreen,
  recipes: RecipesScreen as AnyScreen,
  crypto: CryptoScreen as AnyScreen,
};

interface Session {
  readonly name: string;
  readonly state: any;
  readonly actions: Record<string, Action>;
}

/**
 * Bump only with a deliberate migration design: the host carries exported
 * state across a bundle swap only when old and new declare the same value.
 */
export const STATE_SCHEMA = 1;

export interface GallerySnapshot {
  route: string;
  states: Record<string, unknown>;
  stateSchema: number;
}

export interface GalleryRender {
  scene: DisplayListScene;
  tapRuns: Array<() => void>;
}

/**
 * Shared, deterministic application model for all preview/host adapters.
 * It runs the real gallery screen definitions: initialState(), action
 * handlers, view(), and the shared display-list layout. No browser globals,
 * Android APIs, or Canvas code belong here.
 */
export class GalleryRuntime {
  private current = "home";
  private readonly sessions = new Map<string, Session>();
  private tapRuns: Array<() => void> = [];

  constructor() {
    this.sessions.set("home", this.mount("home"));
  }

  route(): string {
    return this.current;
  }

  routes(): string[] {
    return Object.keys(screens);
  }

  render(): GalleryRender {
    const session = this.sessions.get(this.current) ?? this.mount(this.current);
    this.sessions.set(this.current, session);
    const tree = screens[session.name]!.view({ state: session.state, actions: session.actions }) as WidgetNode;
    const { scene, tapRuns } = layoutScreen(galleryTheme, tree);
    if (this.current !== "home") {
      scene.taps.unshift({ x: 0, y: 0, w: scene.designWidth, h: 96, action: "tap", payload: { id: tapRuns.length } });
      tapRuns.push(() => this.navigate("home"));
    }
    this.tapRuns = tapRuns;
    return { scene, tapRuns };
  }

  navigate(name: string): void {
    if (!(name in screens)) return;
    this.current = name;
    if (!this.sessions.has(name)) this.sessions.set(name, this.mount(name));
  }

  dispatch(action: string, payload: unknown = {}): void {
    // Hosts echo the tap region's action string verbatim ("tap" in the
    // display-list contract), so dispatch is case-insensitive on purpose.
    const normalized = action.toUpperCase();
    if (normalized === "TAP") {
      const id = typeof payload === "number" ? payload : (payload as { id?: unknown })?.id;
      if (typeof id === "number") this.tapRuns[id]?.();
      return;
    }
    if (normalized === "__TENUN_EXPORT") return;
    if (normalized === "TENUN_RESTORE") {
      this.restore(payload as Partial<GallerySnapshot>);
      return;
    }
  }

  exportState(): GallerySnapshot {
    const states: Record<string, unknown> = {};
    for (const [name, session] of this.sessions) states[name] = session.state;
    return { route: this.current, states, stateSchema: STATE_SCHEMA };
  }

  stateSchema(): number {
    return STATE_SCHEMA;
  }

  restore(snapshot: Partial<GallerySnapshot>): void {
    const states = snapshot.states;
    if (states && typeof states === "object") {
      for (const name of Object.keys(states)) {
        if (name in screens) this.sessions.set(name, this.mount(name, states[name]));
      }
    }
    if (typeof snapshot.route === "string" && snapshot.route in screens) this.current = snapshot.route;
  }

  private mount(name: string, restoredState?: unknown): Session {
    const screen = screens[name]!;
    const controller = "controller" in screen ? screen.controller : screen;
    const state = restoredState !== undefined ? restoredState : controller.initialState();
    const actions: Record<string, Action> = {};
    for (const key of Object.keys(controller.actions)) {
      actions[key] = (input?: unknown) => {
        const handler = (controller.actions as Record<string, unknown>)[key] as any;
        const context = { input, state, services: {}, signal: undefined };
        if (typeof handler === "function") handler(context);
        else handler.run(context);
        if (name === "home" && key === "open" && typeof input === "string" && input in screens) {
          this.navigate(input);
        }
      };
    }
    return { name, state, actions };
  }
}
