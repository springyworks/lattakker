// Kept apart from monitorDemos.ts, which the documents for AIs read as plain data (one `export const`).
/** Fingerprints (see seedMigration.ts) of earlier shipped versions of cells that changed since: a saved copy that still is one of them is brought up to date. */
export const MONITOR_OLDER_VERSIONS: Readonly<Record<string, readonly string[]>> = {
  A1: ['50ef5d46', 'e225a94d', 'fbfc6c5f', '9d4849e9', 'e3ce8a96', '116c4010', '91f7c86d', '57fcf5a7', '536c7b3b', '2bc3f9be', 'd0b82686'],
  N1: ['3c2ace60', '22195bdd'],
  N5: ['27aaa082', '8517f09c'],
  N9: ['a3d925eb', 'c63e6d83'],
  A10: ['67f8fb6f', '3eca9d27'],
  G10: ['d795ef8d'],
  A14: ['0862d861', 'd996b6dc'],
};
