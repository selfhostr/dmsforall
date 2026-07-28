import { useTranslation } from 'react-i18next';

import type { ResultatRecherche } from '@dfa/shared';

import { Badge } from '@/components/ui/badge';

import { texteResume } from './resume';

export interface ProprietesResultatOr {
  readonly resultat: ResultatRecherche;
}

// `EtatAfficheOrdreReparation` (snake_case, contrat partagé) -> clé camelCase de `or.json:statuts`.
const CLES_STATUT: Record<string, string> = {
  planifie: 'planifie',
  ouvert: 'ouvert',
  en_cours: 'enCours',
  attente_accord: 'attenteAccord',
  attente_pieces: 'attentePieces',
  attente_externe: 'attenteExterne',
  controle: 'controle',
  termine: 'termine',
  facture: 'facture',
  restitue: 'restitue',
  cloture: 'cloture',
  annule: 'annule',
};

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
      {statut && CLES_STATUT[statut] ? (
        <Badge variant="secondary">{t(`or:statuts.${CLES_STATUT[statut]}`)}</Badge>
      ) : null}
      {plaque ? <span className="texte-libelle text-muted-foreground">{plaque}</span> : null}
      {designationVehicule ? (
        <span className="texte-libelle text-muted-foreground">{designationVehicule}</span>
      ) : null}
    </div>
  );
}
