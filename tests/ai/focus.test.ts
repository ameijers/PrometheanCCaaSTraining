// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

// Variety (manual 9.4b): each new AI scenario gets one of its level's goal types to include, picked at random,
// so skills and outbound profiles get their turn too.
import { pickFocus, userPrompt } from "../../backend/src/ai/scenarios";

test("each of a level's goal types can be picked", () => {
  const picks = [0, 0.4, 0.9].map((r) => pickFocus("build", 4, () => r));
  expect(picks).toEqual(["assignment-method", "capacity", "skills"]);
  expect(pickFocus("interview", 4, () => 0.99)).toBe("skills");
  expect(pickFocus("build", 5, () => 0.99)).toBe("outbound-profile");
});

test("levels without a choice of goal types get no focus", () => {
  expect(pickFocus("route", 2)).toBeUndefined();
  expect(pickFocus("build", 1)).toBeUndefined();
});

test("the prompt asks for the picked goal type", () => {
  expect(userPrompt("build", 4, [], "skills")).toContain("This time, one of the goals must be of type skills.");
  expect(userPrompt("build", 4, [])).not.toContain("This time");
});
