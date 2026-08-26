import { LoaderCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ReponseDossierReprise } from '@dfa/shared';

import { Button } from '@/components/ui/button';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';

import { useAnalyseReprise, useLancerAnalyseReprise } from '@/hooks/reprise/useAnalyseReprise';

interface Props {
  readonly dossier: ReponseDossierReprise;
}

/**
 * Étape 2 — Analyse automatique. AUCUNE question posée (mission). Le contrat n'expose aucune
 * progression CHIFFRÉE de l'analyse (`ReponseAnalyseReprise` porte un `statut`, pas de compteur) —
 * un indicateur d'activité honnête vaut mieux qu'une barre à pourcentage inventée.
 */
export function EtapeAnalyse({ dossier }: Props) {
  const { t } = useTranslation('reprise');
  const analyseDisponible = dossier.analyseId !== null;
  const requete = useAnalyseReprise(dossier.id, analyseDisponible);
  const relancer = useLancerAnalyseReprise(dossier.id);

  return (
    <div className="flex flex-col gap-groupe">
      <h2 id="reprise-etape-titre" tabIndex={-1} className="texte-titre-section">
        {t('reprise:analyse.titre')}
      </h2>
      <p className="texte-corps text-muted-foreground">{t('reprise:analyse.description')}</p>

      {!analyseDisponible || requete.isLoading ? (
        <EtatChargement lignes={2} />
      ) : requete.isError ? (
        <EtatErreur
          titre={t('reprise:erreurChargement.titre')}
          description={t('reprise:erreurChargement.description')}
          onReessayer={() => void requete.refetch()}
        />
      ) : requete.data ? (
        <div aria-live="polite" className="flex flex-col gap-champ">
          {requete.data.statut === 'en_cours' ? (
            <div className="flex items-center gap-2 texte-corps text-muted-foreground">
              <LoaderCircle aria-hidden="true" className="indicateur-chargement h-5 w-5" />
              <span>{t('reprise:analyse.enCours')}</span>
            </div>
          ) : null}

          {requete.data.statut === 'echouee' ? (
            // DESIGN.md « bordure structurelle uniquement » — CONSERVÉE : encart d'alerte
            // (`role="alert"`) qui porte sa propre action (« Réessayer »), pas un simple groupe
            // de contenu.
            <div
              role="alert"
              className="flex flex-col gap-champ rounded-lg border border-destructive p-carte"
            >
              <p className="texte-corps font-medium text-destructive">
                {t('reprise:analyse.echouee.titre')}
              </p>
              <p className="texte-corps">{t('reprise:analyse.echouee.description')}</p>
              <Button
                onClick={() => relancer.mutate()}
                enChargement={relancer.isPending}
                className="self-start"
              >
                {t('reprise:analyse.echouee.reessayer')}
              </Button>
            </div>
          ) : null}

          {requete.data.partielle ? (
            <p className="texte-libelle">{t('reprise:analyse.partielle')}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
