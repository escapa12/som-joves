import type { ComponentType } from 'preact';

/**
 * A mini-game / functionality. To add a new one:
 *  1. create src/modules/<id>/index.tsx exporting a ModuleDef
 *  2. add it to the list in src/modules/index.ts
 *  3. (if it needs data) add its tables with a `<prefix>_` to supabase/schema.sql
 */
export interface ModuleDef {
  id: string;            // url segment: #/<id>/...
  title: string;         // Catalan
  emoji: string;
  /** Optional live icon for the home card (falls back to emoji). */
  Icon?: ComponentType;
  description: string;   // Catalan, one line
  /** Receives the path segments after the module id. */
  Page: ComponentType<{ path: string[] }>;
  /** Optional small badge on the home card (e.g. "2 per jugar"). */
  useBadge?: () => string | null;
}
