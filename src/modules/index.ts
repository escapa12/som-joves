import type { ModuleDef } from '../core/registry';
import { assistencia } from './assistencia';
import { tiers } from './tiers';

/** Order here = order on the home screen. Add new mini-games to this list. */
export const modules: ModuleDef[] = [assistencia, tiers];
