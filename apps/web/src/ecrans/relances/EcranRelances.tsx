import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import {
  schemaUpsertRegleRelance,
  type CanalMessageClient,
  type EntreeUpsertRegleRelance,
  type ReponseEnvoiRelances,
  type ReponsePlanificationRelances,
  type ReponseRegleRelance,
} from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { EtatVidePremierUsage } from '@/composants/motifs/EtatVidePremierUsage';
import { GabaritEcran } from '@/composants/motifs/GabaritEcran';
import { useEnvoyerRelances } from '@/hooks/relances/useEnvoyerRelances';
import { usePlanifierRelances } from '@/hooks/relances/usePlanifierRelances';
import { useReglesRelance } from '@/hooks/relances/useReglesRelance';
import { useUpserterRegleRelance } from '@/hooks/relances/useUpserterRegleRelance';
import { formaterDate } from '@/lib/formats';

import { PALIERS_PREREGLAGE_FACTURE, PREREGLAGE_FACTURE_ECHUE } from './prereglages';

/** Seul type de relance avec un moteur d'envoi ce lot (voir hooks/relances/relances.api.ts) — les
 *  huit autres valeurs de `TypeRelance` existent dans l'enum mais n'ont aucune ligne à afficher
 *  ici avant leur propre lot. */
const TYPE_RELANCE_FACTURE_ECHUE = 'facture_echue' as const;

const CANAUX_FORMULAIRE = ['sms', 'email'] as const satisfies readonly CanalMessageClient[];

/**
 * Écran de gestion des relances automatiques (rappels de facture impayée, lot 1 —
 * `docs/specification-relances-automatiques.md`). Toute la plomberie (hooks TanStack Query,
 * préréglage, i18n) existait déjà avant cet écran — voir `hooks/relances/`, `./prereglages.ts`,
 * `i18n/locales/{fr,de,it}/relances.json`.
 *
 * ÉCART SIGNALÉ (documenté aussi dans `hooks/relances/relances.api.ts`, re-vérifié — issue #136 —
 * toujours vrai : `RelancesController` n'expose que `GET regles`, `PUT regles/:typeRelance`,
 * `POST facturation/planifier`, `POST facturation/envoyer`, aucun `GET` de listing) : aucune route
 * API ne liste `relance_planifiee`/`relance_envoi` — impossible d'afficher une vraie liste
 * « relances planifiées et leur état » ni un historique d'envoi ligne par ligne (qui/quoi/quand/
 * résultat par client), cette donnée n'existe simplement pas côté transport. MANQUE SERVEUR
 * SIGNALÉ, pas traité ici (hors périmètre front) : un `GET /relances/envois` (ou équivalent)
 * paginé par document/client serait nécessaire pour lever cet écart. Le bloc `déclenchement
 * manuel` affiche donc le BILAN de la dernière exécution de chaque opération (nombre créés/ignorés
 * ou envoyés/échoués/annulés), gardé en état local React — PAS dans le cache TanStack Query,
 * puisque ce n'est pas une ressource qu'un `GET` pourrait revalider.
 *
 * Défaut corrigé (issue #136) : le bloc `traçabilité` annonçait littéralement à l'utilisateur
 * final « s'affichera ici dès que l'API de listing des envois sera livrée » — jargon interne
 * (« API ») et promesse de livraison qu'aucun garagiste n'a à connaître pour faire son travail.
 * `relances:tracabilite.note` reformulée en état vide honnête, sans mentionner l'API : le
 * détail par envoi est absent (jamais présenté comme « zéro envoi », ce serait un mensonge — voir
 * `EtatVide`/`EtatVidePremierUsage`, doctrine du dépôt sur l'absence de donnée), et pointe vers le
 * bilan déjà affiché comme seul substitut disponible aujourd'hui.
 */
export function EcranRelances() {
  const { t } = useTranslation(['relances', 'commun']);
  const requete = useReglesRelance();

  // Migré sur `GabaritEcran` (retour @laupernoe du 13.08.2026 : « dans 'Relances' il y a un écart entre
  // le titre et la barre ») — cet écran posait son propre `p-6` EN PLUS du `p-4 sm:p-6` que
  // `AppShell` applique déjà à tout écran routé (même défaut, déjà documenté et corrigé une
  // première fois sur `EcranListeDossiersVente`/`EcranSuiviVentes`, voir le commentaire de tête de
  // `GabaritEcran`) : le padding DOUBLÉ en haut de page se lisait comme un écart vide entre la barre
  // d'onglets de domaine (Factures/Relances) et le titre. Le sous-titre reste un paragraphe normal,
  // premier enfant sous le titre — même patron que l'aide de `EcranRechercheComptoirPieces`.
  return (
    <GabaritEcran titre={t('relances:titre')}>
      <p className="texte-corps text-muted-foreground">{t('relances:sousTitre')}</p>

      {requete.isPending ? (
        <EtatChargement lignes={6} />
      ) : requete.isError ? (
        <EtatErreur
          titre={t('relances:etatErreur.titre')}
          description={messageErreur(requete.error, t)}
          onReessayer={() => void requete.refetch()}
        />
      ) : (
        <>
          <BlocRegleFactureEchue
            regle={requete.data.find((regle) => regle.typeRelance === TYPE_RELANCE_FACTURE_ECHUE)}
          />
          <BlocDeclenchementManuel />
          <BlocTracabilite />
        </>
      )}
    </GabaritEcran>
  );
}

interface PropsBlocRegle {
  readonly regle: ReponseRegleRelance | undefined;
}

/** Règle du rappel « facture échue » — seule règle affichée ce lot (voir l'en-tête ci-dessus).
 *  `regle === undefined` est un état légitime (aucun garage n'a encore réglé ce rappel), pas une
 *  erreur : `EtatVidePremierUsage` plutôt qu'un message d'échec. */
function BlocRegleFactureEchue({ regle }: PropsBlocRegle) {
  const { t } = useTranslation(['relances', 'commun']);
  const [modeEdition, setModeEdition] = useState(false);
  const prereglage = useUpserterRegleRelance();

  const boutonPrereglage = (
    <div className="flex flex-col items-start gap-2">
      <Button
        type="button"
        variant="outline"
        onClick={() =>
          prereglage.mutate({
            typeRelance: TYPE_RELANCE_FACTURE_ECHUE,
            entree: PREREGLAGE_FACTURE_ECHUE,
          })
        }
        disabled={prereglage.isPending}
      >
        {t('relances:regles.prereglage.bouton')}
      </Button>
      <p className="texte-libelle text-muted-foreground">
        {t('relances:regles.prereglage.description', {
          p1: PALIERS_PREREGLAGE_FACTURE[0],
          p2: PALIERS_PREREGLAGE_FACTURE[1],
          p3: PALIERS_PREREGLAGE_FACTURE[2],
        })}
      </p>
      {prereglage.isError ? (
        <p className="texte-libelle text-destructive" role="alert">
          {messageErreur(prereglage.error, t)}
        </p>
      ) : null}
    </div>
  );

  return (
    <section className="flex flex-col gap-4 rounded-lg border p-4">
      <div className="flex flex-col gap-1">
        <h2 className="texte-titre-section">{t('relances:regles.titre')}</h2>
        <p className="texte-corps text-muted-foreground">{t('relances:regles.description')}</p>
      </div>

      {regle === undefined ? (
        <EtatVidePremierUsage
          titre={t('relances:regles.nonConfiguree.titre')}
          description={t('relances:regles.nonConfiguree.description')}
          action={boutonPrereglage}
        />
      ) : (
        <div className="flex flex-col gap-3">
          <Badge variant={regle.actif ? 'default' : 'secondary'} className="w-fit">
            {regle.actif
              ? t('relances:regles.statut.active')
              : t('relances:regles.statut.inactive')}
          </Badge>

          <div>
            <h3 className="texte-libelle font-medium text-foreground">
              {t('relances:regles.paliers.titre')}
            </h3>
            {regle.delaisJours.length === 0 ? (
              <p className="texte-corps text-muted-foreground">
                {t('relances:regles.paliers.vide')}
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {regle.delaisJours.map((jours, index) => (
                  <li key={index} className="texte-corps">
                    {t('relances:regles.paliers.libelle', { n: index + 1 })} —{' '}
                    {t('relances:regles.paliers.jours', { n: jours })}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="texte-libelle font-medium text-foreground">
              {t('relances:regles.canaux.titre')}
            </h3>
            {regle.canaux.length === 0 ? (
              <p className="texte-corps text-muted-foreground">
                {t('relances:regles.canaux.vide')}
              </p>
            ) : (
              <p className="texte-corps">
                {regle.canaux.map((canal) => t(`relances:regles.canaux.${canal}`)).join(', ')}
              </p>
            )}
          </div>

          {/* Une absence n'est jamais affichée comme une valeur : `null` -> rien, pas de date
              bidon ni de « jamais ». */}
          {regle.prereglageAppliqueLe !== null ? (
            <p className="texte-libelle text-muted-foreground">
              {t('relances:regles.prereglage.applique', {
                date: formaterDate(regle.prereglageAppliqueLe),
              })}
            </p>
          ) : null}

          {boutonPrereglage}
        </div>
      )}

      {modeEdition ? (
        <FormulaireRegleFactureEchue
          regle={regle}
          onAnnuler={() => setModeEdition(false)}
          onEnregistre={() => setModeEdition(false)}
        />
      ) : (
        <Button
          type="button"
          variant="secondary"
          className="self-start"
          onClick={() => setModeEdition(true)}
        >
          {t('relances:regles.actions.modifier')}
        </Button>
      )}
    </section>
  );
}

interface PropsFormulaireRegle {
  readonly regle: ReponseRegleRelance | undefined;
  readonly onAnnuler: () => void;
  readonly onEnregistre: () => void;
}

function valeursFormulaireDepuisRegle(
  regle: ReponseRegleRelance | undefined,
): EntreeUpsertRegleRelance {
  if (!regle) {
    return { actif: false, delaisJours: [], canaux: [] };
  }
  return {
    actif: regle.actif,
    delaisJours: [...regle.delaisJours],
    canaux: [...regle.canaux],
  };
}

/**
 * Formulaire manuel — réutilise `schemaUpsertRegleRelance` (`@dfa/shared`) pour la validation,
 * jamais un schéma parallèle. Pas de `zodResolver` : les deux champs tableau (`delaisJours`,
 * `canaux`) sont pilotés par des `Controller` qui gèrent eux-mêmes l'ajout/retrait, la validation
 * du contrat s'exécute explicitement à la soumission (`safeParse`) et pose les erreurs via
 * `form.setError` — un `zodResolver` sur un schéma avec `.refine` au niveau du tableau entier
 * produit un typage `FieldErrors` peu exploitable pour ce cas précis, cette voie manuelle reste
 * strictement équivalente en couverture de validation (le contrat est le même).
 */
function FormulaireRegleFactureEchue({ regle, onAnnuler, onEnregistre }: PropsFormulaireRegle) {
  const { t } = useTranslation(['relances', 'commun']);
  const upserter = useUpserterRegleRelance();
  const form = useForm<EntreeUpsertRegleRelance>({
    defaultValues: valeursFormulaireDepuisRegle(regle),
  });

  const soumettre = form.handleSubmit((valeurs) => {
    const resultat = schemaUpsertRegleRelance.safeParse(valeurs);
    if (!resultat.success) {
      for (const issue of resultat.error.issues) {
        const champ = issue.path[0];
        if (champ === 'delaisJours') {
          form.setError('delaisJours', {
            type: 'manual',
            message:
              issue.path.length > 1
                ? t('relances:regles.formulaire.erreurPalierPositif')
                : t('relances:regles.formulaire.erreurPaliersRequis'),
          });
        } else if (champ === 'canaux') {
          form.setError('canaux', {
            type: 'manual',
            message: t('relances:regles.formulaire.erreurCanauxRequis'),
          });
        }
      }
      return;
    }
    upserter.mutate(
      { typeRelance: TYPE_RELANCE_FACTURE_ECHUE, entree: resultat.data },
      { onSuccess: onEnregistre },
    );
  });

  return (
    <form onSubmit={soumettre} noValidate className="flex flex-col gap-4 border-t pt-4">
      <Controller
        control={form.control}
        name="actif"
        render={({ field }) => (
          <label className="flex items-center gap-2 texte-corps">
            <Checkbox
              checked={field.value}
              onCheckedChange={(coche) => field.onChange(coche === true)}
              disabled={upserter.isPending}
            />
            {t('relances:regles.formulaire.actif')}
          </label>
        )}
      />
      <p className="-mt-2 texte-libelle text-muted-foreground">
        {t('relances:regles.formulaire.actifAide')}
      </p>

      <div className="flex flex-col gap-2">
        <p className="texte-libelle font-medium text-foreground">
          {t('relances:regles.formulaire.paliersLabel')}
        </p>
        <p className="texte-libelle text-muted-foreground">
          {t('relances:regles.formulaire.paliersAide')}
        </p>
        <Controller
          control={form.control}
          name="delaisJours"
          render={({ field }) => (
            <div className="flex flex-col gap-2">
              {field.value.map((valeur, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    value={Number.isNaN(valeur) ? '' : valeur}
                    placeholder={t('relances:regles.formulaire.palierPlaceholder')}
                    aria-label={t('relances:regles.paliers.libelle', { n: index + 1 })}
                    onChange={(evenement) => {
                      const copie = [...field.value];
                      copie[index] = evenement.target.valueAsNumber;
                      field.onChange(copie);
                    }}
                    disabled={upserter.isPending}
                    className="max-w-32"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => field.onChange(field.value.filter((_, i) => i !== index))}
                    disabled={upserter.isPending}
                  >
                    {t('relances:regles.formulaire.supprimerPalier', { n: index + 1 })}
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() => field.onChange([...field.value, Number.NaN])}
                disabled={upserter.isPending}
              >
                {t('relances:regles.formulaire.ajouterPalier')}
              </Button>
            </div>
          )}
        />
        {form.formState.errors.delaisJours ? (
          <p className="texte-libelle text-destructive" role="alert">
            {form.formState.errors.delaisJours.message}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <p className="texte-libelle font-medium text-foreground">
          {t('relances:regles.formulaire.canauxLabel')}
        </p>
        <Controller
          control={form.control}
          name="canaux"
          render={({ field }) => (
            <div className="flex gap-4">
              {CANAUX_FORMULAIRE.map((canal) => (
                <label key={canal} className="flex items-center gap-2 texte-corps">
                  <Checkbox
                    checked={field.value.includes(canal)}
                    onCheckedChange={(coche) => {
                      field.onChange(
                        coche === true
                          ? [...field.value, canal]
                          : field.value.filter((valeur) => valeur !== canal),
                      );
                    }}
                    disabled={upserter.isPending}
                  />
                  {t(`relances:regles.canaux.${canal}`)}
                </label>
              ))}
            </div>
          )}
        />
        {form.formState.errors.canaux ? (
          <p className="texte-libelle text-destructive" role="alert">
            {form.formState.errors.canaux.message}
          </p>
        ) : null}
      </div>

      {upserter.isError ? (
        <p className="texte-libelle text-destructive" role="alert">
          {messageErreur(upserter.error, t)}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={onAnnuler} disabled={upserter.isPending}>
          {t('relances:regles.actions.annuler')}
        </Button>
        <Button type="submit" disabled={upserter.isPending}>
          {upserter.isPending
            ? t('commun:chargement.enCours')
            : t('relances:regles.actions.enregistrer')}
        </Button>
      </div>
    </form>
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
    <section className="flex flex-col gap-4 rounded-lg border p-4">
      <div className="flex flex-col gap-1">
        <h2 className="texte-titre-section">{t('relances:declenchement.titre')}</h2>
        <p className="texte-corps text-muted-foreground">
          {t('relances:declenchement.description')}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
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
      </div>
    </section>
  );
}

/** Note explicative fixe sur l'absence de listing détaillé côté API (voir l'écart signalé en tête
 *  de fichier) — pas de bilan dupliqué ici, celui de chaque déclenchement vit déjà dans
 *  `BlocDeclenchementManuel` ci-dessus. */
function BlocTracabilite() {
  const { t } = useTranslation(['relances', 'commun']);
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-dashed p-4">
      <h2 className="texte-titre-section">{t('relances:tracabilite.titre')}</h2>
      <p className="texte-corps text-muted-foreground">{t('relances:tracabilite.note')}</p>
    </section>
  );
}
