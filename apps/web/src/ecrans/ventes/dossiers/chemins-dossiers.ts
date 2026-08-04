/**
 * Chemins du sous-domaine « dossiers de vente » — `routes/chemins.ts` (hors périmètre de cet
 * agent, câblé par la session principale) n'a pas encore d'entrée `ventes` : même situation que
 * `EcranNouvelOrdreReparation.tsx`/`EcranListeOrdresReparation.tsx` au lot 1, qui définissent leur
 * propre helper local en attendant. Centralisé ICI (un seul fichier pour les trois écrans de ce
 * sous-domaine) plutôt que dupliqué par écran, pour éviter trois définitions divergentes du même
 * chemin — à faire disparaître au profit de `chemins.ts` dès que ce module y est câblé.
 */

function construireChemin(
  base: string,
  parametres: Record<string, string | undefined> = {},
): string {
  const recherche = new URLSearchParams();
  for (const [cle, valeur] of Object.entries(parametres)) {
    if (valeur !== undefined && valeur !== '') recherche.set(cle, valeur);
  }
  const chaine = recherche.toString();
  return chaine === '' ? base : `${base}?${chaine}`;
}

export function cheminListeDossiersVente(site?: string): string {
  return construireChemin('/ventes/dossiers', { site });
}

export function cheminDossierVente(id: string, site?: string): string {
  return construireChemin(`/ventes/dossiers/${id}`, { site });
}

export function cheminNouveauDossierVente(
  site?: string,
  clientId?: string,
  vehiculeId?: string,
): string {
  return construireChemin('/ventes/dossiers/nouveau', { site, clientId, vehiculeId });
}
