import { Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ResultatRecherche } from '@dfa/shared';

import { Badge } from '@/components/ui/badge';
import { formaterPlaque } from '@/lib/plaque';

import { MentionPlaqueHistorique } from './MentionPlaqueHistorique';
import { MentionPlaqueProfessionnelle } from './MentionPlaqueProfessionnelle';
import { booleenResume, nombreResume, objetResume, texteResume } from './resume';

export interface ProprietesResultatVehicule {
  readonly resultat: ResultatRecherche;
}

/** Contenu d'une ligne de résultat « véhicule ». Ne rend aucun conteneur interactif lui-même —
 *  `PanneauResultatsRecherche` l'enveloppe dans un `CommandItem` (résultat courant) ou dans un
 *  bouton simple (`ChoixPlaqueInterchangeable`, RM-18 : pas de mise en avant clavier auto). */
export function ResultatVehicule({ resultat }: ProprietesResultatVehicule) {
  const { t } = useTranslation('recherche');

  const designation = texteResume(resultat.resume.designation) ?? '';
  const plaque = texteResume(resultat.resume.plaque);
  const annee = nombreResume(resultat.resume.annee);
  const detenteurNom = texteResume(resultat.resume.detenteurNom);
  const orOuvert = objetResume(resultat.resume.ordreReparationOuvert);
  const professionnelle = booleenResume(resultat.resume.plaqueProfessionnelle);

  return (
    <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1">
      {plaque ? (
        // Style aligné sur `composants/identite/Plaque.tsx` (taille `md`) : le résumé de
        // recherche livre une chaîne déjà composée ("VD 123456"), sans canton/numéro séparés
        // comme `VehiculeResume` — `Plaque` ne peut donc pas être réutilisé tel quel ici.
        <span className="inline-flex h-6 w-fit items-center rounded border border-input bg-muted px-1.5 text-sm font-semibold tabular-nums text-foreground">
          {formaterPlaque(plaque)}
        </span>
      ) : null}
      <span className="texte-corps font-medium text-foreground">
        {designation}
        {annee !== null ? ` (${annee})` : ''}
      </span>
      {detenteurNom ? (
        <span className="texte-libelle text-muted-foreground">{detenteurNom}</span>
      ) : null}
      {professionnelle ? <MentionPlaqueProfessionnelle /> : null}
      {orOuvert ? (
        <Badge variant="secondary" className="gap-1">
          <Wrench aria-hidden className="h-3 w-3" />
          {t('details.orEnCours')}
        </Badge>
      ) : null}
      {resultat.correspondance.historique ? (
        <MentionPlaqueHistorique
          nomClient={detenteurNom ?? ''}
          porteeJusquLe={resultat.correspondance.porteeJusquLe ?? ''}
        />
      ) : null}
    </div>
  );
}
