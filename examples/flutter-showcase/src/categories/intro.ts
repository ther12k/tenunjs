export interface IntroPage {
  glyph: string;
  title: string;
  body: string;
  from: string;
  to: string;
  accent: string;
}

export const INTRO_PAGES: ReadonlyArray<IntroPage> = [
  {
    glyph: "✦",
    title: "Make room for wonder",
    body: "A calm first step into a collection of beautiful product ideas and thoughtful interactions.",
    from: "#53352B",
    to: "#1E171A",
    accent: "#F5A56B",
  },
  {
    glyph: "⌁",
    title: "Move with intention",
    body: "Small actions, clear feedback, and generous spacing make every flow feel effortless.",
    from: "#294A58",
    to: "#131D26",
    accent: "#7DC8D6",
  },
  {
    glyph: "◌",
    title: "Keep learning",
    body: "Save the patterns you love, then carry them into your own TenunJS application.",
    from: "#493E64",
    to: "#211D32",
    accent: "#C9A8FF",
  },
];
