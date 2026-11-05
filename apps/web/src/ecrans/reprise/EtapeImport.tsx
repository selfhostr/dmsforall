import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import type { ReponseDossierReprise, StatutImportReprise } from '@dfa/shared';

import { Button } from '@/components/ui/button';
import { Meter, MeterIndicator, MeterLabel, MeterTrack, MeterValue } from '@/components/ui/meter';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';

import { useImportReprise, useRejouerImportReprise } from '@/hooks/reprise/useImportReprise';
import { useRapportReprise } from '@/hooks/reprise/useRapportReprise';

import { cleI18nDomaine } from './libelles-domaine';
import { RapportImport } from './RapportImport';

interface Props {
  readonly dossier: ReponseDossierReprise;
}

/** Étape 4 — Import. Progression, puis bilan (`RapportImport`) — lisible dès que l'import a
 *  démarré, pas seulement une fois terminé (mission : « un import qui échoue à 80% n'affiche pas
 *  un écran blanc »). */
export function EtapeImport({ dossier }: Props) {
  const { t } = useTranslation('reprise');
  const importDisponible = dossier.importId !== null;
  const requete = useImportReprise(dossier.id, importDisponible);
  const statutImport = requete.data?.statut;
  const rapportDisponible = requete.data !== undefined && requete.data.statut !== 'en_attente';
  const rapportRequete = useRapportReprise(dossier.id, rapportDisponible, statutImport);
  const rejouer = useRejouerImportReprise(dossier.id);

  // DÉFAUT CORRIGÉ (voir l'en-tête de `useRapportReprise`) : le sondage du rapport s'arrête
  // exactement quand l'import quitte `en_cours` — sans ce dernier appel forcé, le bilan affiché au
  // passage à `termine`/`echoue` resterait celui du tick précédent (jusqu'à 3s de retard, voire
  // jamais rafraîchi si l'import a basculé entre deux ticks), au lieu du bilan réellement final.
  // Gardé sur une TRANSITION depuis `en_cours` précisément (pas sur le simple passage à `true` de
  // `rapportDisponible`) : un dossier déjà `termine` à l'ouverture de l'écran (rechargement de
  // page) a déjà son rapport à jour via le premier fetch normal de `useRapportReprise` — refaire un
  // second appel dans ce cas serait exactement le genre d'appel réseau redondant que ce chantier
  // traque.
  const statutImportPrecedentRef = useRef<StatutImportReprise | undefined>(statutImport);
  useEffect(() => {
    const precedent = statutImportPrecedentRef.current;
    statutImportPrecedentRef.current = statutImport;
    if (precedent === 'en_cours' && statutImport !== undefined && statutImport !== 'en_cours') {
      void rapportRequete.refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statutImport]);

  return (
    <div className="flex flex-col gap-groupe">
      <h2 id="reprise-etape-titre" tabIndex={-1} className="texte-titre-section">
        {t('reprise:import.titre')}
      </h2>
      <p className="text-muted-foreground">{t('reprise:import.description')}</p>

      {!importDisponible || requete.isLoading ? (
        <EtatChargement lignes={2} />
      ) : requete.isError ? (
        <EtatErreur
          titre={t('reprise:erreurChargement.titre')}
          description={t('reprise:erreurChargement.description')}
          onReessayer={() => void requete.refetch()}
        />
      ) : requete.data ? (
        (() => {
          // Capturé en `const` LOCALE pour que le narrowing `!== undefined` survive DANS les
          // fonctions de rendu imbriquées ci-dessous (`MeterValue` exige un enfant sous forme de
          // fonction, voir sa doc de tête dans `@base-ui/react/meter`) — un accès direct à
          // `requete.data.*` à l'intérieur d'une closure n'est PAS narrowed par TypeScript, une
          // propriété pouvant changer entre le contrôle et l'appel du callback.
          const donnees = requete.data;
          return (
            <div aria-live="polite" className="flex flex-col gap-champ">
              {donnees.statut === 'en_attente' || donnees.statut === 'en_cours' ? (
                <>
                  {donnees.domaineCourant ? (
                    <p>
                      {t('reprise:import.domaineCourant', {
                        domaine: t(cleI18nDomaine(donnees.domaineCourant)),
                      })}
                    </p>
                  ) : null}
                  <Meter
                    value={donnees.progression.elementsTraites}
                    max={Math.max(donnees.progression.elementsTotal, 1)}
                  >
                    <MeterLabel>{t('reprise:import.titre')}</MeterLabel>
                    <MeterTrack>
                      <MeterIndicator />
                    </MeterTrack>
                    <MeterValue>
                      {() =>
                        t('reprise:import.progression', {
                          traites: donnees.progression.elementsTraites,
                          total: donnees.progression.elementsTotal,
                          pourcent:
                            donnees.progression.elementsTraites /
                            Math.max(donnees.progression.elementsTotal, 1),
                        })
                      }
                    </MeterValue>
                  </Meter>
                </>
              ) : null}

              {donnees.statut === 'echoue' ? (
                <div
                  role="alert"
                  className="flex flex-col gap-champ rounded-lg border border-destructive p-carte"
                >
                  <p className="font-medium text-destructive">{t('reprise:import.echoue.titre')}</p>
                  <p>{t('reprise:import.echoue.description')}</p>
                  <p className="text-sm text-muted-foreground">
                    {t('reprise:import.echoue.tentative', { numero: donnees.tentative })}
                  </p>
                  <Button
                    onClick={() => rejouer.mutate(undefined)}
                    enChargement={rejouer.isPending}
                    className="self-start"
                  >
                    {t('reprise:import.echoue.relancer')}
                  </Button>
                </div>
              ) : null}

              {donnees.statut === 'termine' ? (
                <div className="rounded-lg border p-carte">
                  <p className="font-medium">{t('reprise:import.termine.titre')}</p>
                  <p className="text-muted-foreground">{t('reprise:import.termine.description')}</p>
                </div>
              ) : null}
            </div>
          );
        })()
      ) : null}

      {rapportRequete.data ? <RapportImport rapport={rapportRequete.data} /> : null}
    </div>
  );
}
