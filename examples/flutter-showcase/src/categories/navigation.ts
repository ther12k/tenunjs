export interface Destination {
  label: string;
  glyph: string;
  title: string;
  body: string;
}

export const DESTINATIONS: ReadonlyArray<Destination> = [
  { label: "Home", glyph: "⌂", title: "A considered home", body: "A quiet landing page makes the next action obvious." },
  { label: "Bookings", glyph: "▣", title: "Your next escape", body: "Keep upcoming stays, dates, and small travel details in one calm place." },
  { label: "Activity", glyph: "◒", title: "Progress you can feel", body: "A focused activity surface turns goals into a gentle daily rhythm." },
  { label: "Courses", glyph: "▤", title: "Keep exploring", body: "A learning shelf gives every saved idea a place to grow." },
  { label: "Profile", glyph: "●", title: "Your preferences", body: "A personal space gathers identity, settings, and saved patterns." },
];
