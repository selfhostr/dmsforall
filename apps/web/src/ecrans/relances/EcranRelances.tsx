import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ReponseEnvoiRelances, ReponsePlanificationRelances } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BoutonChargerPlus } from '@/composants/comptoir/BoutonChargerPlus';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { EtatVide } from '@/composants/commun/EtatVide';
import { GabaritEcran } from '@/composants/motifs/GabaritEcran';
import { useEnvoyerRelances } from '@/hooks/relances/useEnvoyerRelances';
import { useHistoriqueRelances } from '@/hooks/relances/useHistoriqueRelances';
import { usePlanifierRelances } from '@/hooks/relances/usePlanifierRelances';
import { formaterDate } from '@/lib/formats';

import { BadgeStatutEnvoiRelance } from './BadgeStatutEnvoiRelance';

/**
 * Écran de DÉCLENCHEMENT des relances automatiques (rappels de facture impayée) — planification,
 * envoi, historique de traçabilité (issue #136). Reste sous Facturation (§4.5 : « déclenchement ->
 * Factures ») : ce n'est pas un réglage qu'on pose une fois puis qu'on oublie, c'est un écran
 * actionné régulièrement par le comptable.
 *
 * Scindé depuis l'ancien `EcranRelances` (qui mélangeait déclenchement ET réglage des paliers) —
 * voir `EcranReglagesRelances.tsx` pour le pendant configuration, passé sous Réglages. Cet écran
 * ne charge donc plus `GET /relances/regles` : il n'a plus besoin de connaître la règle pour
 * planifier, envoyer, ou lister l'historique.
 *
 * Toute la plomberie (hooks TanStack Query, i18n) existait déjà avant cette scission — voir
 * `hooks/relances/`, `i18n/locales/{fr,de,it}/relances.json`.
 *
 * Le bloc `déclenchement manuel` affiche le BILAN de la dernière exécution de chaque opération
 * (nombre créés/ignorés ou envoyés/échoués/annulés), gardé en état local React — PAS dans le
 * cache TanStack Query, puisque ce n'est pas une ressource qu'un `GET` pourrait revalider.
 *
 * Le bloc `traçabilité` (issue #136) liste RÉELLEMENT `relance_envoi` via
 * `GET /relances/facturation/historique` (`useHistoriqueRelances`) — une ligne PAR TENTATIVE,
 * jamais seulement la dernière (pièce de dossier pour le comptable : « ce client a bien été
 * relancé, et à cette date », y compris face à une contestation qui porte sur une relance déjà
 * remplacée par une suivante).
 */
export function EcranRelances() {
  const { t } = useTranslation(['relances', 'commun']);

  return (
    <GabaritEcran titre={t('relances:titre')}>
      <BlocDeclenchementManuel />
      <BlocTracabilite />
    </GabaritEcran>
  );
}

/** Déclenchement manuel de planification/envoi (RA-05 : idempotent côté serveur, un double clic
 *  n'a aucune conséquence — les boutons ne sont désactivés que PENDANT l'appel en vol, pour éviter
 *  un double-clic accidentel, jamais après un premier succès). */
function BlocDeclenchementManuel() {
  const { t } = useTranslation(['relances', 'commun']);
  const planifier = usePlanifierRelances();
  const envoyer = useEnvoyerRelances();
  const [bilanPlanification, setBilanPlanification] = useState<ReponsePlanificationRelances | null>(
    null,
  );
  const [bilanEnvoi, setBilanEnvoi] = useState<ReponseEnvoiRelances | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="texte-titre-section">{t('relances:declenchement.titre')}</CardTitle>
        <CardDescription>{t('relances:declenchement.description')}</CardDescription>
      </CardHeader>

      {/* Bordures conservées sur les deux panneaux (DESIGN.md) : ce ne sont pas de simples groupes
          de contenu mais deux zones d'action RÉELLES et distinctes (chacune déclenche son propre
          appel serveur, planifier vs envoyer) — les distinguer visuellement évite qu'un bilan
          affiché sous l'un se lise comme appartenant à l'autre. */}
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col items-start gap-2 rounded-md border p-3">
          <h3 className="texte-libelle font-medium text-foreground">
            {t('relances:declenchement.planifier.titre')}
          </h3>
          <p className="texte-corps text-muted-foreground">
            {t('relances:declenchement.planifier.description')}
          </p>
          <Button
            type="button"
            onClick={() =>
              planifier.mutate(undefined, { onSuccess: (bilan) => setBilanPlanification(bilan) })
            }
            disabled={planifier.isPending}
          >
            {planifier.isPending
              ? t('relances:declenchement.planifier.enCours')
              : t('relances:declenchement.planifier.bouton')}
          </Button>
          {planifier.isError ? (
            <p className="texte-libelle text-destructive" role="alert">
              {t('relances:declenchement.erreur', { message: messageErreur(planifier.error, t) })}
            </p>
          ) : null}
          {bilanPlanification ? (
            <div className="texte-corps">
              <p>
                {t('relances:declenchement.planifier.creees', { n: bilanPlanification.creees })}
              </p>
              <p>
                {t('relances:declenchement.planifier.ignorees', {
                  n: bilanPlanification.ignorees,
                })}
              </p>
              <p className="text-muted-foreground">
                {bilanPlanification.encoreATraiter
                  ? t('relances:declenchement.planifier.encore')
                  : t('relances:declenchement.planifier.termine')}
              </p>
            </div>
          ) : null}
        </div>

        <div className="flex flex-col items-start gap-2 rounded-md border p-3">
          <h3 className="texte-libelle font-medium text-foreground">
            {t('relances:declenchement.envoyer.titre')}
          </h3>
          <p className="texte-corps text-muted-foreground">
            {t('relances:declenchement.envoyer.description')}
          </p>
          <Button
            type="button"
            onClick={() =>
              envoyer.mutate(undefined, { onSuccess: (bilan) => setBilanEnvoi(bilan) })
            }
            disabled={envoyer.isPending}
          >
            {envoyer.isPending
              ? t('relances:declenchement.envoyer.enCours')
              : t('relances:declenchement.envoyer.bouton')}
          </Button>
          {envoyer.isError ? (
            <p className="texte-libelle text-destructive" role="alert">
              {t('relances:declenchement.erreur', { message: messageErreur(envoyer.error, t) })}
            </p>
          ) : null}
          {bilanEnvoi ? (
            <div className="texte-corps">
              <p>{t('relances:declenchement.envoyer.envoyees', { n: bilanEnvoi.envoyees })}</p>
              <p>{t('relances:declenchement.envoyer.echouees', { n: bilanEnvoi.echouees })}</p>
              <p>{t('relances:declenchement.envoyer.annulees', { n: bilanEnvoi.annulees })}</p>
              <p className="text-muted-foreground">
                {bilanEnvoi.encoreATraiter
                  ? t('relances:declenchement.envoyer.encore')
                  : t('relances:declenchement.envoyer.termine')}
              </p>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Historique d'envoi réel (issue #136) — une ligne par tentative tracée dans `relance_envoi`,
 * jamais reconstruite depuis le bilan d'exécution de `BlocDeclenchementManuel` ci-dessus (qui ne
 * porte que le total d'un appel, pas le détail par facture/client). Trois états explicites :
 * chargement, aucune relance envoyée (cas normal, pas une erreur), erreur.
 */
function BlocTracabilite() {
  const { t } = useTranslation(['relances', 'commun']);
  const { resultat, elements } = useHistoriqueRelances();

  return (
    // Pas de `Card` ici (DESIGN.md « Application aux tableaux ») : même patron que
    // `ecrans/pointage/VueJournalPointage.tsx`/`VueEquipePointage.tsx` — un tableau porte son
    // propre cadre (`rounded-lg border` sur le wrapper `overflow-x-auto`, filet seul entre les
    // lignes), pas de carte qui l'enveloppe en plus.
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="texte-titre-section">{t('relances:tracabilite.titre')}</h2>
        <p className="texte-corps text-muted-foreground">{t('relances:tracabilite.description')}</p>
      </div>

      {resultat.isPending ? (
        <EtatChargement lignes={3} />
      ) : resultat.isError ? (
        <EtatErreur
          titre={t('relances:tracabilite.etatErreur.titre')}
          description={messageErreur(resultat.error, t)}
          onReessayer={() => void resultat.refetch()}
        />
      ) : elements.length === 0 ? (
        <EtatVide
          titre={t('relances:tracabilite.vide.titre')}
          description={t('relances:tracabilite.vide.description')}
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full texte-corps">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th scope="col" className="py-2 pr-4 font-medium">
                    {t('relances:tracabilite.colonnes.date')}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    {t('relances:tracabilite.colonnes.facture')}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    {t('relances:tracabilite.colonnes.palier')}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    {t('relances:tracabilite.colonnes.destinataire')}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    {t('relances:tracabilite.colonnes.canal')}
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    {t('relances:tracabilite.colonnes.resultat')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {elements.map((envoi) => (
                  <tr key={envoi.id} className="border-b last:border-0">
                    <td className="py-2 pr-4 tabular-nums">{formaterDate(envoi.envoyeLe)}</td>
                    <td className="py-2 pr-4">{envoi.factureNumero ?? '—'}</td>
                    <td className="py-2 pr-4">
                      {t('relances:regles.paliers.libelle', { n: envoi.palier })}
                    </td>
                    <td className="py-2 pr-4">{envoi.destinataire}</td>
                    <td className="py-2 pr-4">{t(`relances:regles.canaux.${envoi.canal}`)}</td>
                    <td className="py-2">
                      <div className="flex flex-col items-start gap-0.5">
                        <BadgeStatutEnvoiRelance statut={envoi.statutEnvoi} />
                        {envoi.statutEnvoi === 'echoue' ? (
                          <span className="texte-libelle text-muted-foreground">
                            {t(`relances:tracabilite.raisons.${envoi.raisonEchec ?? 'inconnue'}`)}
                          </span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <BoutonChargerPlus
              aChargerPlus={resultat.hasNextPage ?? false}
              enChargement={resultat.isFetchingNextPage}
              onChargerPlus={() => void resultat.fetchNextPage()}
              className="border-t"
            />
          </div>
        </>
      )}
    </section>
  );
}
