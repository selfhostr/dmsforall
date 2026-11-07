import { useTranslation } from 'react-i18next';

import {
  ETATS_AFFICHES_ORDRE_REPARATION,
  type EtatAfficheOrdreReparation,
  type ResultatRecherche,
} from '@dfa/shared';

import { BadgeStatutOr } from '@/composants/identite/BadgeStatutOr';

import { texteResume } from './resume';

export interface ProprietesResultatOr {
  readonly resultat: ResultatRecherche;
}

function estEtatAffiche(valeur: string | null): valeur is EtatAfficheOrdreReparation {
  return valeur !== null && (ETATS_AFFICHES_ORDRE_REPARATION as readonly string[]).includes(valeur);
}

/** Contenu d'une ligne de résultat « ordre de réparation ». Enveloppé dans un `CommandItem` par
 *  `PanneauResultatsRecherche`. Le statut affiché est celui remonté par le serveur (`etatAffiche`
 *  côté OR, §2.3) — jamais recalculé côté client. */
export function ResultatOr({ resultat }: ProprietesResultatOr) {
  const { t } = useTranslation(['or', 'recherche']);

  const numero = texteResume(resultat.resume.numero) ?? '';
  const statut = texteResume(resultat.resume.statut);
  const plaque = texteResume(resultat.resume.plaque);
  const designationVehicule = texteResume(resultat.resume.designationVehicule);

  return (
    <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1">
      <span className="texte-corps font-medium text-foreground">{t('or:numero', { numero })}</span>
      {estEtatAffiche(statut) ? <BadgeStatutOr etat={statut} /> : null}
      {plaque ? <span className="texte-libelle text-muted-foreground">{plaque}</span> : null}
      {designationVehicule ? (
        <span className="texte-libelle text-muted-foreground">{designationVehicule}</span>
      ) : null}
    </div>
  );
}
