export * from "./categories/intro";
export * from "./categories/hotel";
export * from "./categories/fitness";
export * from "./categories/course";
export * from "./categories/navigation";

/**
 * App identity for the launcher host. Each id names an independent
 * app study: the browser preview and the Android-style shell mount one
 * session per id, and closing an app preserves its session state.
 */
export type ShowcaseAppId = "intro" | "hotel" | "fitness" | "course" | "navigation";

export interface ShowcaseAppEntry {
  id: ShowcaseAppId;
  /** Typed-route name inside the standalone example app. */
  route: string;
  title: string;
  blurb: string;
  glyph: string;
  accent: string;
}

/** The launcher catalog: one entry per independent app study. */
export const SHOWCASE_APPS: ReadonlyArray<ShowcaseAppEntry> = [
  {
    id: "intro",
    route: "intro",
    title: "Introduction animation",
    blurb: "A warm three-step welcome flow with a focused sign-up reveal.",
    glyph: "✦",
    accent: "#F5A56B",
  },
  {
    id: "hotel",
    route: "hotel",
    title: "Hotel booking",
    blurb: "Search stays, filter destinations, select a room, and confirm.",
    glyph: "⌂",
    accent: "#7DC8D6",
  },
  {
    id: "fitness",
    route: "fitness",
    title: "Fitness dashboard",
    blurb: "Activity rings, weekly progress, and a workout completion loop.",
    glyph: "◒",
    accent: "#70D6A2",
  },
  {
    id: "course",
    route: "course",
    title: "Design course",
    blurb: "Browse a learning shelf, enroll, resume, and complete lessons.",
    glyph: "▤",
    accent: "#C9A8FF",
  },
  {
    id: "navigation",
    route: "navigation",
    title: "Custom drawer",
    blurb: "A dedicated Material navigation study with preserved destinations.",
    glyph: "☰",
    accent: "#F5C26B",
  },
];

export const SHOWCASE_APP_IDS: ReadonlyArray<ShowcaseAppId> = SHOWCASE_APPS.map((app) => app.id);

export function isShowcaseAppId(value: string): value is ShowcaseAppId {
  return (SHOWCASE_APP_IDS as ReadonlyArray<string>).includes(value);
}
