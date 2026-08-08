import type { ResultatRecherche, SaisonPneu, StatutDepotPneus } from '@dfa/shared';
import { SAISONS_PNEU, STATUTS_DEPOT_PNEUS } from '@dfa/shared';

import { BadgeSaisonPneu } from '@/ecrans/pneus/composants/BadgeSaisonPneu';
import { BadgeStatutDepotPneu } from '@/ecrans/pneus/composants/BadgeStatutDepotPneu';
import { formaterPlaque } from '@/lib/plaque';

import { texteResume } from './resume';

export interface ProprietesResultatDepotPneu {
  readonly resultat: ResultatRecherche;
}

function estSaisonPneu(valeur: string | null): valeur is SaisonPneu {
  return valeur !== null && (SAISONS_PNEU as readonly string[]).includes(valeur);
}

function estStatutDepotPneus(valeur: string | null): valeur is StatutDepotPneus {
  return valeur !== null && (STATUTS_DEPOT_PNEUS as readonly string[]).includes(valeur);
}

/** Contenu d'une ligne de résultat « dépôt de pneus ». Enveloppé dans un `CommandItem` par
 *  `PanneauResultatsRecherche` — même patron que `ResultatClient`/`ResultatOr`. Réutilise
 *  `BadgeSaisonPneu`/`BadgeStatutDepotPneu` (déjà utilisés par `CarteJeuPneu`, hangar à pneus)
 *  plutôt que de réinventer un second jeu de couleurs pour les mêmes distinctions. */
export function ResultatDepotPneu({ resultat }: ProprietesResultatDepotPneu) {
  const saison = texteResume(resultat.resume.saison);
  const statut = texteResume(resultat.resume.statut);
  const designationVehicule = texteResume(resultat.resume.designationVehicule);
  const codeCase = texteResume(resultat.resume.codeCase);
  const plaque = texteResume(resultat.resume.plaque);
  const detenteurNom = texteResume(resultat.resume.detenteurNom);

  return (
    <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1">
      {codeCase ? (
        <span className="inline-flex h-6 w-fit items-center rounded border border-input bg-muted px-1.5 font-mono text-sm font-semibold text-foreground">
          {codeCase}
        </span>
      ) : null}
      {estSaisonPneu(saison) ? <BadgeSaisonPneu saison={saison} /> : null}
      {estStatutDepotPneus(statut) ? <BadgeStatutDepotPneu statut={statut} /> : null}
      {designationVehicule ? (
        <span className="texte-corps font-medium text-foreground">{designationVehicule}</span>
      ) : null}
      {plaque ? (
        <span className="texte-libelle text-muted-foreground">{formaterPlaque(plaque)}</span>
      ) : null}
      {detenteurNom ? (
        <span className="texte-libelle text-muted-foreground">{detenteurNom}</span>
      ) : null}
    </div>
  );
}
