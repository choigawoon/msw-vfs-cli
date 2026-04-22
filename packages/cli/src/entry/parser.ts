// EntryParser — common contract for a parsed MSW entry file.
//
// An "entry" is one file the tool opens (.map / .ui / .gamelogic / .model
// today; more types to follow). Every EntryParser implementation exposes
// a minimal set of operations the tool relies on regardless of the entry's
// internal shape (entity container vs flat values table vs future types).
//
// Implementations:
//   - EntitiesEntryParser (formerly EntitiesVFS)   — map/ui/gamelogic
//   - ModelEntryParser    (formerly ModelVFS)      — model
//
// Layer 1 (structural / VFS-like) and Layer 2 (semantic, entity-oriented)
// APIs live on top of this contract. See COMMANDS.md.

import type { AssetType } from '../types';

export interface EntrySaveResult {
  ok: boolean;
  path: string;
  warnings?: string[];
  error?: string;
}

/** Minimum shape for validate() output. Parsers may return richer objects
 *  (e.g. EntitiesEntryParser adds `entity_count`, ModelEntryParser adds
 *  `values_count`) — subtypes remain assignable via width subtyping. */
export interface EntryValidateResult {
  ok: boolean;
  warnings: string[];
}

export interface EntryParser {
  /** Discriminator — identifies the concrete entry type. */
  readonly type: AssetType;
  /** Absolute path of the loaded file, or null for in-memory / YAML-sourced entries. */
  readonly filePath: string | null;
  /** True when the parser has unsaved mutations. */
  readonly isDirty: boolean;
  /** Structural integrity check. Shape-specific details may extend the base. */
  validate(): EntryValidateResult;
  /** Write to `outputPath` or back to `filePath`. */
  save(outputPath?: string | null): EntrySaveResult;
}
