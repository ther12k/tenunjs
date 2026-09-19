/**
 * Compatibility surface: the showcase home is now the explicit launcher
 * screen. Public example imports (routes, tests) keep working unchanged.
 */
export { LauncherScreen, type ShowcaseHomeState } from "./launcher.screen";
export { LauncherScreen as HomeScreen } from "./launcher.screen";
export { SHOWCASE_APPS as MODULES } from "../data";
