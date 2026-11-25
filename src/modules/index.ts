import type { ModuleDef } from '../core/registry';
import { assistencia } from './assistencia';
import { tiers } from './tiers';
import { nomateix } from './nomateix';
import { fdps } from './fdps';
import { enquesta } from './enquesta';

/** Order here = order on the home screen. Add new mini-games to this list. */
export const modules: ModuleDef[] = [assistencia, enquesta, tiers, nomateix, fdps];
