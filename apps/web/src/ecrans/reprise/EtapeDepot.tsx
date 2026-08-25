import { useTranslation } from 'react-i18next';

import type { ReponseDossierReprise } from '@dfa/shared';

import { Button } from '@/components/ui/button';
import { Meter, MeterIndicator, MeterLabel, MeterTrack, MeterValue } from '@/components/ui/meter';

import {
  useTeleversementArchive,
  type TypeErreurDepot,
} from '@/hooks/reprise/useTeleversementArchive';

import { ZoneDepotFichier } from './ZoneDepotFichier';

interface Props {
  readonly dossierEnCours: ReponseDossierReprise | null;
}

function octetsVersMo(octets: number): string {
  return (octets / (1024 * 1024)).toFixed(1);
}

/** Clé typée sur `TypeErreurDepot` (exhaustif, pas `Record<string, string>`) : un index sur une
 *  clé de string GÉNÉRIQUE serait `string | undefined` sous `noUncheckedIndexedAccess`
 *  (tsconfig.base.json) — un accès sur cette union FERMÉE reste `string`, sans `?? repli` requis. */
const CLES_ERREUR: Record<TypeErreurDepot, string> = {
  reseau: 'reprise:depot.erreur.reseau',
  integrite: 'reprise:depot.erreur.integrite',
  tailleInattendue: 'reprise:depot.erreur.tailleInattendue',
  fichierDifferent: 'reprise:depot.reprise.fichierDifferent',
  generique: 'reprise:depot.erreur.generique',
};

/**
 * Étape 1 — Dépôt. LA seule étape où le garagiste fournit quelque chose (mission : « le moins
 * d'interaction possible » — une décision à un seul moment, et ce n'est même pas celle-ci : ici,
 * il n'y a qu'un fichier à glisser).
 *
 * `dossierEnCours` non `null` avec `statut === 'depot_en_cours'` -> un dépôt a été interrompu :
 * bandeau explicatif, mais la MÊME zone de dépôt sert à le reprendre (`useTeleversementArchive`
 * détecte lui-même qu'il doit reprendre plutôt que créer un nouveau dossier).
 */
export function EtapeDepot({ dossierEnCours }: Props) {
  const { t } = useTranslation('reprise');
  const { etat, demarrerDepot, reessayer } = useTeleversementArchive(dossierEnCours);

  const depotInterrompuNonRepris =
    dossierEnCours?.statut === 'depot_en_cours' && etat.phase === 'attente';
  const pourcentInterrompu = dossierEnCours
    ? dossierEnCours.archive.octetsRecus / Math.max(dossierEnCours.archive.tailleOctetsAnnoncee, 1)
    : 0;

  const enCours = etat.phase !== 'attente' && etat.phase !== 'erreur' && etat.phase !== 'termine';

  return (
    <div className="flex flex-col gap-groupe">
      <div>
        <h2 id="reprise-etape-titre" tabIndex={-1} className="texte-titre-section">
          {t('reprise:depot.titre')}
        </h2>
        <p className="text-muted-foreground">{t('reprise:depot.description')}</p>
      </div>

      {depotInterrompuNonRepris ? (
        <div role="status" className="rounded-lg border border-dashed bg-muted p-carte text-sm">
          <p className="font-medium">{t('reprise:depot.reprise.titre')}</p>
          <p>{t('reprise:depot.reprise.description', { pourcent: pourcentInterrompu })}</p>
        </div>
      ) : null}

      <ZoneDepotFichier onFichierChoisi={demarrerDepot} desactive={enCours} />

      <div aria-live="polite" className="flex flex-col gap-champ">
        {etat.phase === 'verification' ? (
          <Meter value={etat.octetsTraites} max={Math.max(etat.octetsTotal, 1)}>
            <MeterLabel>{t('reprise:depot.phase.verification')}</MeterLabel>
            <MeterTrack>
              <MeterIndicator />
            </MeterTrack>
            <MeterValue>
              {() =>
                t('reprise:depot.phase.verificationProgression', {
                  pourcent: etat.octetsTraites / Math.max(etat.octetsTotal, 1),
                })
              }
            </MeterValue>
          </Meter>
        ) : null}

        {etat.phase === 'creation' ? <p>{t('reprise:depot.phase.creation')}</p> : null}

        {etat.phase === 'envoi' ? (
          <Meter value={etat.octetsTraites} max={Math.max(etat.octetsTotal, 1)}>
            <MeterLabel>{t('reprise:depot.phase.envoi')}</MeterLabel>
            <MeterTrack>
              <MeterIndicator />
            </MeterTrack>
            <MeterValue>
              {() =>
                t('reprise:depot.phase.envoiProgression', {
                  envoyeMo: octetsVersMo(etat.octetsTraites),
                  totalMo: octetsVersMo(etat.octetsTotal),
                  pourcent: etat.octetsTraites / Math.max(etat.octetsTotal, 1),
                })
              }
            </MeterValue>
          </Meter>
        ) : null}

        {etat.phase === 'finalisation' ? <p>{t('reprise:depot.phase.finalisation')}</p> : null}

        {etat.phase === 'erreur' ? (
          <div
            role="alert"
            className="flex flex-col gap-champ rounded-lg border border-destructive p-carte"
          >
            <p className="font-medium text-destructive">{t('reprise:depot.erreur.titre')}</p>
            <p>{t(CLES_ERREUR[etat.erreur ?? 'generique'])}</p>
            {etat.erreur !== 'fichierDifferent' && etat.erreur !== 'tailleInattendue' ? (
              <Button onClick={reessayer} className="self-start">
                {t('reprise:depot.erreur.reessayer')}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
