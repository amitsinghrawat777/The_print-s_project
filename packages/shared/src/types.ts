export const COLOR_MODES = ["bw", "color"] as const;
export type ColorMode = (typeof COLOR_MODES)[number];

export const SIDES = ["single", "double"] as const;
export type Sides = (typeof SIDES)[number];

export const PAPER_SIZES = ["A4", "A3", "Legal"] as const;
export type PaperSize = (typeof PAPER_SIZES)[number];
