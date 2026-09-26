import type { ScreenDefinition } from "@tenunjs/core";
import { ApplicationRuntime } from "@tenunjs/widgets";
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
import { OnboardingScreen } from "../gallery/src/screens/onboarding.screen";
import { PlantsScreen } from "../gallery/src/screens/plants.screen";
import { ProfileScreen } from "../gallery/src/screens/profile.screen";
import { ThemeLabScreen } from "../gallery/src/screens/theme-lab.screen";
import type { DisplayListScene } from "../ui-kit/src/display-list";

type AnyScreen = ScreenDefinition<any, any>;

/**
 * Gallery application composition — the EXAMPLE residue after the
 * TN-133 extraction: which screens exist, the shared theme, the
 * non-home back affordance, and the forgiving navigate service the
 * home screen wires through `services.navigate`. Execution, lowering,
 * snapshots, and host handoff live in the public @tenunjs/widgets
 * runtime this wrapper composes.
 */
const screens: Record<string, AnyScreen> = {
  home: HomeScreen as AnyScreen,
  views: ViewsScreen as AnyScreen,
  onboarding: OnboardingScreen as AnyScreen,
  plants: PlantsScreen as AnyScreen,
  profile: ProfileScreen as AnyScreen,
  themeLab: ThemeLabScreen as AnyScreen,
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
 * Thin gallery wrapper over the public ApplicationRuntime. Keeps the
 * shape every existing consumer (browser preview shell, preview app
 * bundle, Android device bundle) already drives, while the loop itself
 * is the supported public contract. Adds exactly two example behaviors
 * on top:
 *
 *  - a back bar on every non-home scene (chrome — the runtime renders
 *    screens, the app decides navigation affordances), and
 *  - state carry across bundle swaps that is FORGIVING about screens a
 *    newer bundle removed (hot-reload/Fast-Refresh semantics; the
 *    public runtime's strict restore would reject them).
 */
export class GalleryRuntime {
  private readonly app: ApplicationRuntime;

  constructor() {
    this.app = new ApplicationRuntime({
      screens,
      initial: "home",
      theme: galleryTheme,
      services: {
        // Home-screen navigation goes through the service, not runtime
        // magic; unknown routes stay on the current screen (the legacy
        // loop's behavior, preserved example-side).
        navigate: (route: string) => {
          if (route in screens) this.app.navigate(route);
        },
      },
    });
  }

  /** The public runtime this wrapper composes (host handoff target). */
  get runtime(): ApplicationRuntime {
    return this.app;
  }

  route(): string {
    return this.app.route();
  }

  routes(): string[] {
    return this.app.routes();
  }

  render(): GalleryRender {
    const render = this.app.render();
    if (this.app.route() !== "home") {
      render.scene.taps.unshift({
        x: 0,
        y: 0,
        w: render.scene.designWidth,
        h: 96,
        action: "tap",
        payload: { id: render.tapRuns.length },
      });
      render.tapRuns.push(() => this.app.navigate("home"));
    }
    return render;
  }

  navigate(name: string): void {
    // Legacy gallery behavior: unknown routes are ignored (the strict
    // public runtime would throw — this wrapper keeps the example's
    // forgiving surface for its existing consumers).
    if (name in screens) this.app.navigate(name);
  }

  dispatch(action: string, payload: unknown = {}): void {
    // Restore through the gallery's forgiving path: the public runtime
    // restores strictly when dispatched directly, and state carry across
    // bundle swaps must tolerate screens a newer bundle removed.
    if (action.toUpperCase() === "TENUN_RESTORE") {
      this.restore(payload as Partial<GallerySnapshot>);
      return;
    }
    this.app.dispatch(action, payload);
  }

  exportState(): GallerySnapshot {
    return this.app.exportState();
  }

  stateSchema(): number {
    return this.app.stateSchema();
  }

  restore(snapshot: Partial<GallerySnapshot>): void {
    this.app.restore(snapshot, { ignoreUnknownScreens: true });
  }
}
