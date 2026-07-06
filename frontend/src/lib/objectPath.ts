/** A shallow draft object keyed by dotted paths (e.g. "defaults.steps"). */
export type Draft = Record<string, unknown>;

/** Read the value at a dotted `path` (e.g. "defaults.steps") from `obj`. */
export const getPath = (obj: Draft, path: string): unknown =>
  path.split(".").reduce<unknown>(
    (acc, key) => (acc == null ? undefined : (acc as Draft)[key]),
    obj,
  );

/** Return a deep clone of `obj` with `value` set at the dotted `path`. */
export const setPath = (obj: Draft, path: string, value: unknown): Draft => {
  const keys = path.split(".");
  const next = structuredClone(obj);
  let cur = next as Draft;
  for (let i = 0; i < keys.length - 1; i += 1) cur = cur[keys[i]] as Draft;
  cur[keys[keys.length - 1]] = value;
  return next;
};
