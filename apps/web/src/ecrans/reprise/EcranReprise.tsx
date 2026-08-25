import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ReponseDossierReprise, StatutDossierReprise } from '@dfa/shared';

import { Button } from '@/components/ui/button';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { GabaritEcran } from '@/composants/motifs/GabaritEcran';

import { useDossierRepriseActif } from '@/hooks/reprise/useDossierRepriseActif';

import { DialogueAnnulerReprise } from './DialogueAnnulerReprise';
import { EnTeteEtapesReprise, type EtapeReprise } from './EnTeteEtapesReprise';
import { EtapeAnalyse } from './EtapeAnalyse';
import { EtapeDepot } from './EtapeDepot';
import { EtapeImport } from './EtapeImport';
import { EtapeValidationPlan } from './EtapeValidationPlan';

/** `dossier === null` (aucun dossier n'existe encore) est traité comme l'étape Dépôt : c'est
 *  exactement le même écran qu'un dépôt interrompu, juste sans bandeau de reprise. `'annule'` est
 *  un état à part, hors du bandeau des 4 étapes (voir `EcranReprise` plus bas). */
export function determinerEtapeAffichee(
  dossier: ReponseDossierReprise | null,
): EtapeReprise | 'annule' {
  const statut: StatutDossierReprise | undefined = dossier?.statut;
  if (statut === undefined || statut === 'depot_en_cours') return 'depot';
  if (statut === 'annule') return 'annule';
  if (
    statut === 'depot_receptionne' ||
    statut === 'analyse_en_cours' ||
    statut === 'analyse_echouee' ||
    statut === 'analyse_terminee'
  ) {
    return 'analyse';
  }
  if (statut === 'plan_propose' || statut === 'plan_valide') return 'validation';
  // import_en_cours | import_termine | import_echoue
  return 'import';
}

const STATUTS_NON_TERMINAUX_ANNULABLES: readonly StatutDossierReprise[] = [
  'depot_en_cours',
  'depot_receptionne',
  'analyse_en_cours',
  'analyse_echouee',
  'analyse_terminee',
  'plan_propose',
  'plan_valide',
  'import_en_cours',
  'import_echoue',
];

/**
 * Point d'entrée routé de la reprise de données (`/reprise-donnees`). Source de vérité unique :
 * `useDossierRepriseActif` (la collection `GET /reprise/dossiers`, voir sa doc de tête — aucun
 * `GET` par id n'existe dans le contrat). L'étape affichée est ENTIÈREMENT dérivée de
 * `dossier.statut`, y compris les transitions automatiques du serveur
 * (`depot_receptionne -> analyse_en_cours`, `analyse_terminee -> plan_propose`,
 * `plan_valide -> import_en_cours`) : aucune de ces transitions n'est déclenchée par un clic ici,
 * le sondage de `useDossierRepriseActif` les révèle au fur et à mesure.
 */
export function EcranReprise() {
  const { t } = useTranslation('reprise');
  const requete = useDossierRepriseActif();
  const dossier = requete.data ?? null;
  const etapeBrute = determinerEtapeAffichee(dossier);
  // Un dossier `annule` reste le plus récent de la collection tant qu'aucun nouveau dépôt n'a
  // commencé (`useDossierRepriseActif` prend le PLUS RÉCENT) : ce drapeau local fait
  // temporairement passer l'écran sur l'étape Dépôt sans attendre un nouveau dossier serveur —
  // `useTeleversementArchive` ignore de toute façon un dossier `annule` (seul `depot_en_cours`
  // déclenche une reprise), un dépôt lancé depuis ici crée donc bien un dossier NEUF.
  const [depotForce, setDepotForce] = useState(false);
  const estAnnule = etapeBrute === 'annule' && !depotForce;
  // Jamais `'annule'` : c'est ce qui rend `etape` directement assignable à `EnTeteEtapesReprise`
  // (`EtapeReprise`) sans cast — la branche « dossier annulé » ci-dessous est rendue à la place
  // dès que `estAnnule` est vrai, cette valeur n'est alors simplement pas utilisée.
  const etape: EtapeReprise = etapeBrute === 'annule' ? 'depot' : etapeBrute;

  useEffect(() => {
    if (etapeBrute !== 'annule') setDepotForce(false);
  }, [etapeBrute]);

  // Focus géré au changement d'étape (WCAG 2.4.3) : le titre de l'étape courante (`id="reprise-
  // etape-titre"`, posé par chaque composant `Etape*`) reçoit le focus dès qu'il apparaît, pour
  // qu'un lecteur d'écran annonce la nouvelle étape sans que l'utilisateur doive chercher où le
  // focus est parti.
  useEffect(() => {
    if (requete.isSuccess) {
      const element = document.getElementById('reprise-etape-titre');
      element?.focus();
    }
  }, [etape, estAnnule, requete.isSuccess]);

  const peutAnnuler = dossier !== null && STATUTS_NON_TERMINAUX_ANNULABLES.includes(dossier.statut);

  return (
    <GabaritEcran
      titre={t('reprise:titre')}
      actions={
        dossier && peutAnnuler ? <DialogueAnnulerReprise dossierId={dossier.id} /> : undefined
      }
    >
      <div className="flex flex-col gap-groupe">
        {requete.isLoading ? (
          <EtatChargement lignes={3} />
        ) : requete.isError ? (
          <EtatErreur
            titre={t('reprise:erreurChargement.titre')}
            description={t('reprise:erreurChargement.description')}
            onReessayer={() => void requete.refetch()}
          />
        ) : estAnnule && dossier ? (
          <div className="flex flex-col items-start gap-groupe rounded-lg border border-dashed p-carte">
            <h2 id="reprise-etape-titre" tabIndex={-1} className="texte-titre-section">
              {t('reprise:dossierAnnule.titre')}
            </h2>
            <p className="text-muted-foreground">{t('reprise:dossierAnnule.description')}</p>
            <Button onClick={() => setDepotForce(true)}>
              {t('reprise:dossierAnnule.nouveau')}
            </Button>
          </div>
        ) : (
          <>
            <EnTeteEtapesReprise etapeActive={etape} />
            {etape === 'depot' ? <EtapeDepot dossierEnCours={dossier} /> : null}
            {etape === 'analyse' && dossier ? <EtapeAnalyse dossier={dossier} /> : null}
            {etape === 'validation' && dossier ? <EtapeValidationPlan dossier={dossier} /> : null}
            {etape === 'import' && dossier ? <EtapeImport dossier={dossier} /> : null}
          </>
        )}
      </div>
    </GabaritEcran>
  );
}
