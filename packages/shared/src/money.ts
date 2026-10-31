/** All money is integer paise (₹1 = 100 paise). */

export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

/** Rounds to the nearest whole rupee, halves rounding up. */
export function roundToRupee(paise: number): number {
  return Math.floor((paise + 50) / 100) * 100;
}

/** 5200 -> "₹52", 250 -> "₹2.50" */
export function formatPaise(paise: number): string {
  const rupees = paise / 100;
  const text = Number.isInteger(rupees)
    ? rupees.toLocaleString("en-IN")
    : rupees.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `₹${text}`;
}
