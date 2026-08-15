import { describe, expect, it } from "vitest";
import { cloneRecipe, recipeFingerprint, runWithConcurrency } from "./batch";
import { DEFAULT_RECIPE } from "./types";

describe("browser batch coordinator", () => {
  it("never runs more than two workers at once", async () => {
    let active = 0;
    let maximum = 0;
    const releases: Array<() => void> = [];
    const task = runWithConcurrency([1, 2, 3, 4, 5], 2, async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
    });

    await Promise.resolve();
    expect(active).toBe(2);
    while (releases.length > 0) {
      releases.shift()?.();
      await Promise.resolve();
      await Promise.resolve();
    }
    await task;
    expect(maximum).toBe(2);
  });

  it("does not start another item after cancellation", async () => {
    let stopped = false;
    const started: number[] = [];
    await runWithConcurrency([1, 2, 3, 4], 2, async (item) => {
      started.push(item);
      stopped = true;
    }, () => stopped);
    expect(started).toEqual([1]);
  });

  it("clones recipes and fingerprints the exact snapshot", () => {
    const snapshot = cloneRecipe(DEFAULT_RECIPE);
    snapshot.settings.speed = 0.8;
    expect(DEFAULT_RECIPE.settings.speed).toBe(1);
    expect(recipeFingerprint(snapshot)).toBe(recipeFingerprint(cloneRecipe(snapshot)));
    expect(recipeFingerprint(snapshot)).not.toBe(recipeFingerprint(DEFAULT_RECIPE));
  });
});
