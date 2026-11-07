import { Pencil } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ReponseContexteAtelier, ReponseVehicule } from '@dfa/shared';

import { Button } from '@/components/ui/button';
import { formaterDate, formaterKilometrage } from '@/lib/formats';
import { IdentiteVehicule } from '@/composants/identite/IdentiteVehicule';
import { BoutonCopier } from '@/composants/vehicule/BoutonCopier';
import { ChampEmplacementVehicule } from '@/composants/vehicule/ChampEmplacementVehicule';
import { useSession } from '@/hooks/useSession';

import { DialogueModifierIdentiteVehicule } from './DialogueModifierIdentiteVehicule';
import { peutGererPlaqueVehicule, peutModifierVehicule } from './droits';

interface Props {
  readonly vehicule: ReponseVehicule;
  readonly dernierKilometrage: ReponseContexteAtelier['dernierKilometrage'];
}

interface DefinitionChamp {
  readonly libelle: string;
  readonly valeur: string;
  readonly copiable?: boolean;
}

/**
 * En-tête de fiche : identité compacte (`IdentiteVehicule`, taille `xl` — invariant n°1, jamais
 * recomposée localement) + les champs d'identification que le comptoir lit au téléphone (VIN,
 * code type, kilométrage actuel). Le kilométrage vient du contexte-atelier (`dernierKilometrage`),
 * pas de `ReponseVehicule` qui ne le porte pas — voir `packages/shared/…/vehicule.ts`.
 *
 * `peutModifier` (`ChampEmplacementVehicule` et le crayon d'identité ci-dessous) est calculé ICI
 * depuis la session (`vehicule.modifier`, `droits.ts`) — tant que la session n'est pas résolue,
 * `role === undefined` -> `peutModifierVehicule` rend `false` -> le crayon reste absent jusqu'à
 * confirmation du droit, jamais l'inverse (bouton visible puis retiré), même principe que
 * `EcranListeFactures`.
 *
 * Le crayon d'identité (`DialogueModifierIdentiteVehicule`) est le geste manquant relevé en test
 * d'utilisabilité (§tête de fichier) : sans lui, un véhicule créé sans plaque après un refus de
 * saisie silencieux n'avait aucun moyen d'en recevoir une depuis la fiche. Gardé par
 * `peutModifierVehicule` seul (le droit du `PATCH` sur l'identité) — la section plaque à
 * l'intérieur du dialogue a son propre gardien, plus restrictif (`peutGererPlaqueVehicule`),
 * documenté dans `DialogueModifierIdentiteVehicule.tsx`.
 */
export function EnTeteFicheVehicule({ vehicule, dernierKilometrage }: Props) {
  const { t } = useTranslation('vehicules');
  const { data: session } = useSession();
  const peutModifierEmplacement = peutModifierVehicule(session?.actions);
  const peutGererPlaque = peutGererPlaqueVehicule(session?.actions);
  const [dialogueIdentiteOuvert, setDialogueIdentiteOuvert] = useState(false);

  const champs: DefinitionChamp[] = [];
  if (vehicule.vin)
    champs.push({ libelle: t('identite.vin'), valeur: vehicule.vin, copiable: true });
  if (vehicule.codeTypeCh)
    champs.push({ libelle: t('identite.codeType'), valeur: vehicule.codeTypeCh, copiable: true });
  if (vehicule.premiereMiseEnCirculationLe) {
    champs.push({
      libelle: t('identite.mise1reCirc'),
      valeur: formaterDate(vehicule.premiereMiseEnCirculationLe),
    });
  }
  if (dernierKilometrage) {
    champs.push({
      libelle: t('identite.kmActuels'),
      valeur: formaterKilometrage(dernierKilometrage.valeurKm, 'km'),
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1">
        <IdentiteVehicule vehicule={vehicule} taillePlaque="xl" />
        {peutModifierEmplacement ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setDialogueIdentiteOuvert(true)}
            aria-label={t('vehicules:fiche.actions.modifierTitre')}
            title={t('vehicules:fiche.actions.modifierTitre')}
          >
            <Pencil aria-hidden className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
      {peutModifierEmplacement ? (
        <DialogueModifierIdentiteVehicule
          vehicule={vehicule}
          peutGererPlaque={peutGererPlaque}
          ouvert={dialogueIdentiteOuvert}
          onOuvertChange={setDialogueIdentiteOuvert}
        />
      ) : null}
      {champs.length > 0 ? (
        <dl className="densite-dense flex flex-wrap gap-x-6 gap-y-1">
          {champs.map((champ) => (
            <div key={champ.libelle} className="flex items-center gap-1">
              <dt className="texte-libelle text-muted-foreground">{champ.libelle} :</dt>
              <dd className="flex items-center gap-1 texte-corps font-medium">
                {champ.valeur}
                {champ.copiable ? <BoutonCopier valeur={champ.valeur} /> : null}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      <ChampEmplacementVehicule
        vehiculeId={vehicule.id}
        emplacement={vehicule.emplacementLibre}
        majLe={vehicule.emplacementMajLe}
        peutModifier={peutModifierEmplacement}
      />
    </div>
  );
}
