import { useTranslation } from 'react-i18next';

import type { EntreeAjustementPlanReprise, ReponseDossierReprise } from '@dfa/shared';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { EtatVide } from '@/composants/commun/EtatVide';

import {
  useModifierPlanReprise,
  usePlanReprise,
  useValiderPlanReprise,
} from '@/hooks/reprise/usePlanReprise';

import { cleI18nDomaine, cleI18nMotifExclusion } from './libelles-domaine';

interface Props {
  readonly dossier: ReponseDossierReprise;
}

/**
 * Étape 3 — Validation. L'UNIQUE décision demandée au garagiste (mission). Le SEUL levier :
 * inclure/exclure un `DomaineReprise` EN BLOC (`ElementPlanReprise.inclus`) — jamais un éditeur de
 * correspondance de champs, jamais un nom de table technique affiché. Un seul bouton primaire
 * (« Lancer l'import ») déclenche `plan_propose -> plan_valide -> import_en_cours` dans le même
 * geste, conforme au contrat (aucun second clic requis).
 */
export function EtapeValidationPlan({ dossier }: Props) {
  const { t } = useTranslation('reprise');
  const planDisponible = dossier.planId !== null;
  const requete = usePlanReprise(dossier.id, planDisponible);
  const modifier = useModifierPlanReprise(dossier.id);
  const valider = useValiderPlanReprise(dossier.id);

  function basculer(ajustement: EntreeAjustementPlanReprise) {
    modifier.mutate([ajustement]);
  }

  return (
    <div className="flex flex-col gap-groupe">
      <h2 id="reprise-etape-titre" tabIndex={-1} className="texte-titre-section">
        {t('reprise:plan.titre')}
      </h2>
      <p className="text-muted-foreground">{t('reprise:plan.description')}</p>

      {!planDisponible || requete.isLoading ? (
        <EtatChargement lignes={4} />
      ) : requete.isError ? (
        <EtatErreur
          titre={t('reprise:erreurChargement.titre')}
          description={t('reprise:erreurChargement.description')}
          onReessayer={() => void requete.refetch()}
        />
      ) : requete.data &&
        requete.data.elements.length === 0 &&
        requete.data.exclusions.length === 0 ? (
        <EtatVide
          titre={t('reprise:plan.vide.titre')}
          description={t('reprise:plan.vide.description')}
        />
      ) : requete.data ? (
        <>
          <ul className="flex flex-col gap-champ">
            {requete.data.elements.map((element) => (
              <li
                key={element.id}
                className="flex items-center gap-groupe rounded-lg border p-carte"
              >
                <Checkbox
                  id={`plan-element-${element.id}`}
                  checked={element.inclus}
                  disabled={
                    !element.ajustable || requete.data.statut !== 'propose' || modifier.isPending
                  }
                  onCheckedChange={(coche) =>
                    basculer({ elementId: element.id, inclus: coche === true })
                  }
                  aria-label={t('reprise:plan.inclure', {
                    domaine: t(cleI18nDomaine(element.domaine)),
                  })}
                />
                <label htmlFor={`plan-element-${element.id}`} className="flex-1">
                  <span className="block font-medium">{t(cleI18nDomaine(element.domaine))}</span>
                  <span className="block text-sm text-muted-foreground">
                    {t('reprise:plan.volumeAttendu', { count: element.volumeAttenduLignes })}
                  </span>
                </label>
              </li>
            ))}
          </ul>

          {requete.data.exclusions.length > 0 ? (
            <div className="rounded-lg border border-dashed p-carte">
              <p className="mb-2 font-medium text-muted-foreground">
                {t('reprise:plan.exclu.titre')}
              </p>
              <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
                {requete.data.exclusions.map((exclusion) => (
                  <li key={exclusion.tableDetecteeId}>
                    {t(cleI18nMotifExclusion(exclusion.motif))}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {requete.data.statut === 'propose' ? (
            <div className="flex flex-col items-start gap-champ">
              <Button onClick={() => valider.mutate()} enChargement={valider.isPending} size="lg">
                {t('reprise:plan.action.lancer')}
              </Button>
              <p className="text-sm text-muted-foreground">
                {t('reprise:plan.action.confirmation')}
              </p>
            </div>
          ) : null}

          {valider.isError ? (
            <p role="alert" className="text-destructive">
              {t('reprise:erreurChargement.description')}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
