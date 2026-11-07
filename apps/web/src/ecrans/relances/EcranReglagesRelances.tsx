import { CheckCircle2, Circle } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import {
  schemaUpsertRegleRelance,
  type CanalMessageClient,
  type EntreeUpsertRegleRelance,
  type ReponseRegleRelance,
} from '@dfa/shared';

import { AideContextuelle } from '@/composants/AideContextuelle';
import { messageErreur } from '@/api/erreurs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { EtatVidePremierUsage } from '@/composants/motifs/EtatVidePremierUsage';
import { GabaritEcran } from '@/composants/motifs/GabaritEcran';
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
 * Écran de RÉGLAGE des relances automatiques — paliers, canaux, préréglage (§4.5 de la refonte
 * navigation : « paliers -> Réglages »). Scindé depuis l'ancien `EcranRelances` (qui mélangeait
 * réglage ET déclenchement) : voir `EcranRelances.tsx` pour le pendant opérationnel
 * (planifier/envoyer/historique), resté sous Facturation.
 *
 * Toute la plomberie (hooks TanStack Query, préréglage, i18n) existait déjà avant cette scission —
 * voir `hooks/relances/`, `./prereglages.ts`, `i18n/locales/{fr,de,it}/relances.json`.
 */
export function EcranReglagesRelances() {
  const { t } = useTranslation(['relances', 'commun']);
  const requete = useReglesRelance();

  return (
    <GabaritEcran titre={t('relances:reglages.titre')} sousTitre={t('relances:reglages.sousTitre')}>
      {requete.isPending ? (
        <EtatChargement lignes={6} />
      ) : requete.isError ? (
        <EtatErreur
          titre={t('relances:etatErreur.titre')}
          description={messageErreur(requete.error, t)}
          onReessayer={() => void requete.refetch()}
        />
      ) : (
        <BlocRegleFactureEchue
          regle={requete.data.find((regle) => regle.typeRelance === TYPE_RELANCE_FACTURE_ECHUE)}
        />
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
    <Card>
      <CardHeader>
        <div className="flex items-center gap-1.5">
          <CardTitle className="texte-titre-section">{t('relances:regles.titre')}</CardTitle>
          <AideContextuelle sujet={t('relances:regles.titre')} texte={t('aide:relances.regles')} />
        </div>
        <CardDescription>{t('relances:regles.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {regle === undefined ? (
          <EtatVidePremierUsage
            titre={t('relances:regles.nonConfiguree.titre')}
            description={t('relances:regles.nonConfiguree.description')}
            action={boutonPrereglage}
          />
        ) : (
          <div className="flex flex-col gap-3">
            {/* `variant="secondary"`/`"outline"` (Badge générique), jamais `"default"` (bg-primary,
                couleur de MARQUE) : un badge de statut ne réutilise jamais la teinte de marque
                comme signal (même doctrine que `BadgeStatutEnvoiRelance.tsx`). Icône ajoutée
                (forme + icône + mot, DESIGN.md) — ce badge était jusqu'ici couleur seule. */}
            <Badge variant={regle.actif ? 'secondary' : 'outline'} className="w-fit">
              {regle.actif ? (
                <CheckCircle2 aria-hidden className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <Circle aria-hidden className="h-3.5 w-3.5 shrink-0" />
              )}
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
      </CardContent>
    </Card>
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
