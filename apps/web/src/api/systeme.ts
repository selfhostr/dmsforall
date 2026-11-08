import type { VersionSysteme } from '@dfa/shared';

import { requeteApi } from './client';

/** `GET /systeme/version` — version installée et dernière version publiée. */
export async function recupererVersionSysteme(): Promise<VersionSysteme> {
  const version = await requeteApi<VersionSysteme>('/systeme/version', { method: 'GET' });
  if (!version) {
    throw new Error('Réponse de version inattendue : corps vide.');
  }
  return version;
}
