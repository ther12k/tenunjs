export interface Hotel {
  id: string;
  name: string;
  place: string;
  price: number;
  rating: number;
  glyph: string;
  tint: string;
  category: string;
  tags: ReadonlyArray<string>;
}

export const HOTEL_CATEGORIES = ["All", "Beach", "City", "Nature"] as const;

export const HOTELS: ReadonlyArray<Hotel> = [
  {
    id: "cove",
    name: "The Quiet Cove",
    place: "Nusa Dua · Bali",
    price: 186,
    rating: 4.9,
    glyph: "◒",
    tint: "#294B4A",
    category: "Beach",
    tags: ["Ocean view", "Breakfast"],
  },
  {
    id: "atlas",
    name: "Atlas House",
    place: "Old Town · Lisbon",
    price: 142,
    rating: 4.8,
    glyph: "⌂",
    tint: "#4B3A58",
    category: "City",
    tags: ["Rooftop", "Walkable"],
  },
  {
    id: "pine",
    name: "Pine & Stone",
    place: "Ubud · Bali",
    price: 118,
    rating: 4.7,
    glyph: "♧",
    tint: "#3A5038",
    category: "Nature",
    tags: ["Pool", "Quiet"],
  },
  {
    id: "marais",
    name: "Maison Marais",
    place: "Le Marais · Paris",
    price: 204,
    rating: 4.6,
    glyph: "✦",
    tint: "#534239",
    category: "City",
    tags: ["Design", "Cafe nearby"],
  },
];
