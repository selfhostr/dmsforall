import { useTranslation } from 'react-i18next';

import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ChampMontant } from '@/composants/comptoir/ChampMontant';

import { SelecteurOrganismeVente } from './SelecteurOrganismeVente';

/** Forme locale du bloc dette — les DEUX champs organisme du contrat (`detteFinancementOrganismeId`
 *  / `detteFinancementOrganismeNom`) sont mutuellement exclusifs à la saisie (§8.1 du design :
 *  « recherche client/tiers OU texte libre »), jamais fusionnés côté serveur (au moins l'un des
 *  deux quand un montant est renseigné, vérifié serveur — voir `contrats/ventes/reprise.ts`). */
export interface ValeursDetteFinancement {
  readonly montantCentimes: number | null;
  readonly organismeMode: 'client' | 'texteLibre';
  readonly organismeId: string | null;
  readonly organismeNom: string;
}

export const VALEURS_DETTE_VIDES: ValeursDetteFinancement = {
  montantCentimes: null,
  organismeMode: 'client',
  organismeId: null,
  organismeNom: '',
};

interface Props {
  readonly valeurs: ValeursDetteFinancement;
  readonly onChange: (valeurs: ValeursDetteFinancement) => void;
  readonly disabled?: boolean;
}

/**
 * Bloc « dette de financement résiduelle » (RV-26/CV-02) — condition suspensive de la reprise,
 * montant optionnel. Une case à cocher révèle le montant + le choix organisme (client existant OU
 * texte libre), partagée entre `DialogueCreationReprise` et le futur dialog de modification.
 */
export function ChampDetteFinancementReprise({ valeurs, onChange, disabled }: Props) {
  const { t } = useTranslation(['ventes', 'commun']);
  const active = valeurs.montantCentimes !== null;

  function basculerActive(coche: boolean) {
    onChange(coche ? { ...valeurs, montantCentimes: 0 } : { ...VALEURS_DETTE_VIDES });
  }

  // DESIGN.md « bordure structurelle uniquement » — CONSERVÉE : widget de saisie à part entière
  // (case à cocher qui révèle un sous-formulaire complet — montant, choix organisme), pas un
  // simple regroupement de champs statiques — même doctrine que le fieldset « demandes » de
  // `FormulaireNouvelOrdreReparation.tsx` (atelier, « ce groupe porte son propre comportement »).
  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      <div className="flex items-center gap-2">
        <Checkbox
          id="reprise-dette-active"
          checked={active}
          disabled={disabled}
          onCheckedChange={(coche) => basculerActive(coche === true)}
        />
        <Label htmlFor="reprise-dette-active" className="font-normal">
          {t('ventes:reprise.creation.detteActive')}
        </Label>
      </div>

      {active ? (
        <div className="flex flex-col gap-3 pl-6">
          <ChampMontant
            label={t('ventes:reprise.creation.detteMontant')}
            valeurCentimes={valeurs.montantCentimes}
            onChangeCentimes={(centimes) => onChange({ ...valeurs, montantCentimes: centimes })}
            disabled={disabled}
          />

          <div className="flex flex-col gap-1.5">
            <Label>{t('ventes:reprise.creation.detteOrganisme')}</Label>
            <div className="flex gap-4 texte-corps">
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="reprise-dette-organisme-mode"
                  checked={valeurs.organismeMode === 'client'}
                  disabled={disabled}
                  onChange={() =>
                    onChange({ ...valeurs, organismeMode: 'client', organismeNom: '' })
                  }
                />
                {t('ventes:reprise.creation.detteOrganismeModeClient')}
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="reprise-dette-organisme-mode"
                  checked={valeurs.organismeMode === 'texteLibre'}
                  disabled={disabled}
                  onChange={() =>
                    onChange({ ...valeurs, organismeMode: 'texteLibre', organismeId: null })
                  }
                />
                {t('ventes:reprise.creation.detteOrganismeModeTexteLibre')}
              </label>
            </div>
          </div>

          {/* Une fois la dette activée, AU MOINS l'un des deux (client existant OU texte libre)
           *  est obligatoire (`reprise_dette_organisme_coherent_chk`, `db/schema/ventes/reprise.ts`)
           *  — non encodé en zod (« vérifié serveur »), mais bien une obligation réelle : sans
           *  étoile ici, un réceptionniste qui coche « dette » et ne renseigne aucun organisme se
           *  fait bloquer par un 400 serveur qu'il ne comprend pas. */}
          {valeurs.organismeMode === 'client' ? (
            <SelecteurOrganismeVente
              label={t('ventes:reprise.creation.detteOrganismeRecherche')}
              obligatoire
              valeur={valeurs.organismeId}
              onChangeValeur={(clientId) => onChange({ ...valeurs, organismeId: clientId })}
            />
          ) : (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reprise-dette-organisme-texte" requis>
                {t('ventes:reprise.creation.detteOrganismeTexte')}
              </Label>
              <Input
                id="reprise-dette-organisme-texte"
                value={valeurs.organismeNom}
                disabled={disabled}
                required
                onChange={(evenement) =>
                  onChange({ ...valeurs, organismeNom: evenement.target.value })
                }
              />
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** `ValeursDetteFinancement` -> triplet nu conforme au contrat (`detteFinancementResiduelleCentimes`
 *  / `detteFinancementOrganismeId` / `detteFinancementOrganismeNom`), tous `null` si la case est
 *  décochée. Partagé par la création ET la modification (mêmes trois champs dans les deux
 *  schémas — `schemaCreationReprise`/`schemaModificationReprise`, `contrats/ventes/reprise.ts`). */
export function versEntreeDette(valeurs: ValeursDetteFinancement): {
  readonly detteFinancementResiduelleCentimes: number | null;
  readonly detteFinancementOrganismeId: string | null;
  readonly detteFinancementOrganismeNom: string | null;
} {
  if (valeurs.montantCentimes === null) {
    return {
      detteFinancementResiduelleCentimes: null,
      detteFinancementOrganismeId: null,
      detteFinancementOrganismeNom: null,
    };
  }
  return {
    detteFinancementResiduelleCentimes: valeurs.montantCentimes,
    detteFinancementOrganismeId: valeurs.organismeMode === 'client' ? valeurs.organismeId : null,
    detteFinancementOrganismeNom:
      valeurs.organismeMode === 'texteLibre' && valeurs.organismeNom.trim() !== ''
        ? valeurs.organismeNom.trim()
        : null,
  };
}
