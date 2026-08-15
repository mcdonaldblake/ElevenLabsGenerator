export async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
  shouldStop: () => boolean = () => false,
): Promise<void> {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("Concurrency must be at least one.");
  let cursor = 0;
  const next = (): { item: T; index: number } | null => {
    if (shouldStop() || cursor >= items.length) return null;
    const index = cursor;
    cursor += 1;
    return { item: items[index] as T, index };
  };
  const work = async () => {
    for (let task = next(); task; task = next()) await worker(task.item, task.index);
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, work));
}

export function cloneRecipe<T>(recipe: T): T {
  return JSON.parse(JSON.stringify(recipe)) as T;
}

export function recipeFingerprint(recipe: unknown): string {
  const serialized = JSON.stringify(recipe);
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
