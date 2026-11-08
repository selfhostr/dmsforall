import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { schemaModificationReprise, type ReponseReprise } from '@dfa/shared';

import { ErreurApi, messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import { LegendeChampsObligatoires } from '@/components/ui/label';
import { ChampMontant } from '@/composants/comptoir/ChampMontant';
import { PanneauLateral } from '@/composants/PanneauLateral';
import { RefusBloquant } from '@/composants/motifs/RefusBloquant';
import { useModifierReprise } from '@/hooks/ventes/reprises/useTransitionsReprise';

import {
  ChampDetteFinancementReprise,
  VALEURS_DETTE_VIDES,
  versEntreeDette,
  type ValeursDetteFinancement,
} from './ChampDetteFinancementReprise';

interface Props {
  readonly dossierVenteId: string;
  readonly reprise: ReponseReprise;
  readonly ouvert: boolean;
  readonly onOuvertChange: (ouvert: boolean) => void;
  readonly onMutationReussie?: () => void;
}

/**
 * Révision de la valeur estimée (§8.4 du design) — UNIQUEMENT tant que `statut = estimee`
 * (RV-27, contrôlé serveur ; `CarteReprise` ne propose déjà le bouton « Modifier » que dans ce
 * cas). `If-Match` construit depuis `reprise.version` (`W/"<version>"`, même patron que
 * `EcranFicheFacture.tsx`).
 */
export function DialogueModifierReprise({
  dossierVenteId,
  reprise,
  ouvert,
  onOuvertChange,
  onMutationReussie,
}: Props) {
  const { t } = useTranslation(['ventes', 'commun', 'validation', 'erreurs']);
  const modifier = useModifierReprise(dossierVenteId);

  const [valeurEstimeeCentimes, setValeurEstimeeCentimes] = useState<number | null>(null);
  const [dette, setDette] = useState<ValeursDetteFinancement>(VALEURS_DETTE_VIDES);
  const [erreurValidation, setErreurValidation] = useState<string | null>(null);

  useEffect(() => {
    if (!ouvert) return;
    setValeurEstimeeCentimes(reprise.valeurEstimeeCentimes);
    setDette(
      reprise.detteFinancementResiduelleCentimes === null
        ? VALEURS_DETTE_VIDES
        : {
            montantCentimes: reprise.detteFinancementResiduelleCentimes,
            organismeMode: reprise.detteFinancementOrganismeId ? 'client' : 'texteLibre',
            organismeId: reprise.detteFinancementOrganismeId,
            organismeNom: reprise.detteFinancementOrganismeNom ?? '',
          },
    );
    setErreurValidation(null);
    modifier.reset();
    // Dépend UNIQUEMENT de `ouvert` (patron `DialogueModifierDossierVente`) : `reprise` vient
    // d'un `useQuery` sans `staleTime`, donc `refetchOnWindowFocus` (défaut TanStack Query v5) lui
    // donne une nouvelle référence à chaque retour de focus fenêtre — dépendre de `reprise` ici
    // rejouerait l'effet et écraserait une saisie en cours à chaque changement de fenêtre pendant
    // l'édition. Réinitialise à CHAQUE ouverture (pas seulement au montage) : la même instance de
    // dialog est réutilisée sans être démontée entre deux ouvertures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ouvert]);

  const erreurActive = modifier.error instanceof ErreurApi ? modifier.error : null;

  function soumettre() {
    const resultat = schemaModificationReprise.safeParse({
      valeurEstimeeCentimes: valeurEstimeeCentimes ?? undefined,
      ...versEntreeDette(dette),
    });
    if (!resultat.success) {
      setErreurValidation(t('validation:requis'));
      return;
    }
    setErreurValidation(null);
    modifier.mutate(
      { entree: resultat.data, etag: `W/"${reprise.version}"` },
      {
        onSuccess: () => {
          onOuvertChange(false);
          onMutationReussie?.();
        },
      },
    );
  }

  return (
    <PanneauLateral
      ouvert={ouvert}
      onOuvertChange={onOuvertChange}
      titre={t('ventes:reprise.modification.titre')}
      pied={
        <>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOuvertChange(false)}
            disabled={modifier.isPending}
          >
            {t('commun:actions.annuler')}
          </Button>
          <Button type="submit" form="reprise-modification" disabled={modifier.isPending}>
            {modifier.isPending
              ? t('commun:chargement.enCours')
              : t('ventes:reprise.modification.bouton')}
          </Button>
        </>
      }
    >
      <form
        id="reprise-modification"
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(evenement) => {
          evenement.preventDefault();
          soumettre();
        }}
      >
        <LegendeChampsObligatoires>
          {t('commun:formulaires.champsObligatoiresLegende')}
        </LegendeChampsObligatoires>

        <ChampMontant
          label={t('ventes:reprise.creation.valeurEstimee')}
          obligatoire
          valeurCentimes={valeurEstimeeCentimes}
          onChangeCentimes={setValeurEstimeeCentimes}
        />
        <ChampDetteFinancementReprise valeurs={dette} onChange={setDette} />
        {erreurValidation ? (
          <p className="texte-libelle text-destructive">{erreurValidation}</p>
        ) : null}

        {erreurActive ? (
          <RefusBloquant
            code={erreurActive.probleme.code}
            blocages={erreurActive.blocages}
            actionsProposees={erreurActive.actionsProposees}
          />
        ) : modifier.error ? (
          <p className="texte-libelle text-destructive" role="alert">
            {messageErreur(modifier.error, t)}
          </p>
        ) : null}
      </form>
    </PanneauLateral>
  );
}
