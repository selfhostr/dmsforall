import type { ResultatRecherche, StatutFournisseur } from '@dfa/shared';
import { STATUTS_FOURNISSEUR } from '@dfa/shared';

import { BadgeStatutFournisseur } from '@/ecrans/pieces/BadgeStatutFournisseur';

import { texteResume } from './resume';

export interface ProprietesResultatFournisseur {
  readonly resultat: ResultatRecherche;
}

function estStatutFournisseur(valeur: string | null): valeur is StatutFournisseur {
  return valeur !== null && (STATUTS_FOURNISSEUR as readonly string[]).includes(valeur);
}

/** Contenu d'une ligne de résultat « fournisseur ». Enveloppé dans un `CommandItem` par
 *  `PanneauResultatsRecherche` — même patron que `ResultatClient`/`ResultatOr`. */
export function ResultatFournisseur({ resultat }: ProprietesResultatFournisseur) {
  const nom = texteResume(resultat.resume.nom) ?? '';
  const statut = texteResume(resultat.resume.statut);

  return (
    <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1">
      <span className="texte-corps font-medium text-foreground">{nom}</span>
      {estStatutFournisseur(statut) ? <BadgeStatutFournisseur statut={statut} /> : null}
    </div>
  );
}
