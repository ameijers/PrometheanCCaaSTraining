// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

// The Toolbox's example CSVs, as the training uses them. Two of their phone numbers (+31 20 123 4567 and
// +31 20 123 4568) aren't in a range reserved for fiction, so they become Ofcom drama numbers. The
// other example number, +1 800 555 0100, is already in the 555-0100–0199 fiction range.
export const EXAMPLE_NUMBERS: Record<string, string> = {
  "+31201234567": "+442079460201",
  "+31201234568": "+442079460202"
};

export function fictionExample(csvText: string): string {
  return Object.entries(EXAMPLE_NUMBERS).reduce((text, [real, fiction]) => text.split(real).join(fiction), csvText);
}
