// Small fixed palette so each speaker in a transcript gets a consistent,
// visually distinct color, assigned deterministically by name (no state
// needed, no color reused unnecessarily until the palette runs out).
const PALETTE = [
  { text: "text-indigo-700", bg: "bg-indigo-100", dot: "bg-indigo-500" },
  { text: "text-teal-700", bg: "bg-teal-100", dot: "bg-teal-500" },
  { text: "text-amber-700", bg: "bg-amber-100", dot: "bg-amber-500" },
  { text: "text-rose-700", bg: "bg-rose-100", dot: "bg-rose-500" },
  { text: "text-violet-700", bg: "bg-violet-100", dot: "bg-violet-500" },
  { text: "text-cyan-700", bg: "bg-cyan-100", dot: "bg-cyan-500" },
];

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function speakerColor(speakerLabel: string) {
  const index = hashString(speakerLabel) % PALETTE.length;
  return PALETTE[index];
}

// Same palette family as above (indigo/teal/amber/rose/violet/cyan), as hex
// values for chart libraries that need a real color, not a Tailwind class.
// Same hash function + same palette length, so a given speaker always lands
// on the matching color family in both the transcript and the charts.
const HEX_PALETTE = [
  "#4f46e5", // indigo-600
  "#0d9488", // teal-600
  "#d97706", // amber-600
  "#e11d48", // rose-600
  "#7c3aed", // violet-600
  "#0891b2", // cyan-600
];

export function speakerHexColor(speakerLabel: string): string {
  const index = hashString(speakerLabel) % HEX_PALETTE.length;
  return HEX_PALETTE[index];
}
