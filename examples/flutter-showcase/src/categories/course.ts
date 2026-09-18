export interface Course {
  id: string;
  title: string;
  author: string;
  category: string;
  lessons: number;
  minutes: number;
  progress: number;
  glyph: string;
  tint: string;
}

export const COURSE_CATEGORIES = ["All", "Product", "Motion", "Craft"] as const;

export const COURSES: ReadonlyArray<Course> = [
  { id: "space", title: "Designing with space", author: "Maya Chen", category: "Product", lessons: 8, minutes: 96, progress: 0.62, glyph: "□", tint: "#4A3E5D" },
  { id: "motion", title: "Motion with meaning", author: "Alex Rivera", category: "Motion", lessons: 6, minutes: 74, progress: 0.24, glyph: "◌", tint: "#294E5D" },
  { id: "type", title: "Type that speaks", author: "Nadia Park", category: "Craft", lessons: 10, minutes: 122, progress: 0.88, glyph: "Aa", tint: "#58422D" },
  { id: "systems", title: "Build a visual system", author: "Owen Wells", category: "Product", lessons: 12, minutes: 148, progress: 0, glyph: "✦", tint: "#315044" },
];
