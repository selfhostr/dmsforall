import { CheckCircle2, Lock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import {
  POLITIQUES_DEUX_OR_MEME_VEHICULE,
  POLITIQUES_LANGUE_DOCUMENT,
  POLITIQUES_MENTION_SECURITE,
  PORTEES_NUMEROTATION,
  UNITES_TEMPS,
  VISIBILITES_HISTORIQUE_VEHICULE,
  type PolitiqueControleQualite,
  type ReponseParametresAtelier,
} from '@dfa/shared';

import { ErreurApi, messageErreur, messageErreurChamp } from '@/api/erreurs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { ChampMontant } from '@/composants/comptoir/ChampMontant';
import { GabaritEcran } from '@/composants/motifs/GabaritEcran';
import {
  useModifierParametresAtelier,
  type EntreeModificationParametresAtelier,
} from '@/hooks/parametres/useModifierParametresAtelier';
import { useParametresAtelier } from '@/hooks/parametres/useParametresAtelier';
import { useSession } from '@/hooks/useSession';

import { peutModifierParametrage } from './droits';

/** Contrôle qualité restreint à `jamais`/`toujours` au lot 1 (CHECK SQL Δ3, voir
 *  `gouvernance-fonctionnalites.ts`) — les deux autres valeurs de l'union existent dans le type
 *  mais n'apparaissent JAMAIS dans ce select : un garage qui les choisirait recevrait un
 *  `400 VALIDATION_ECHOUEE` que rien ne justifierait puisque l'UI l'aurait proposé. */
const CONTROLE_QUALITE_LOT1 = [
  'jamais',
  'toujours',
] as const satisfies readonly PolitiqueControleQualite[];

interface ValeursFormulaireAtelier {
  readonly prefixe: string;
  readonly porteeNumerotation: (typeof PORTEES_NUMEROTATION)[number];
  readonly resetAnnuel: boolean;
  readonly etatPlanifieActif: boolean;
  readonly sansRdvAutorise: boolean;
  readonly rdvRetroactifAuto: boolean;
  readonly deuxOrMemeVehicule: (typeof POLITIQUES_DEUX_OR_MEME_VEHICULE)[number];
  readonly kmEntreeObligatoire: boolean;
  readonly kmSortieObligatoire: boolean;
  readonly plafondDefautCentimes: number | null;
  readonly uniteTemps: (typeof UNITES_TEMPS)[number];
  readonly controleQualite: (typeof CONTROLE_QUALITE_LOT1)[number];
  readonly langueDocument: (typeof POLITIQUES_LANGUE_DOCUMENT)[number];
  readonly mentionSecurite: (typeof POLITIQUES_MENTION_SECURITE)[number];
  readonly expertiseAlerteMois: number;
  readonly visibiliteHistorique: (typeof VISIBILITES_HISTORIQUE_VEHICULE)[number];
}

function versValeursFormulaire(donnees: ReponseParametresAtelier): ValeursFormulaireAtelier {
  return {
    prefixe: donnees.or.prefixe,
    porteeNumerotation: donnees.or.porteeNumerotation,
    resetAnnuel: donnees.or.resetAnnuel,
    etatPlanifieActif: donnees.or.etatPlanifieActif,
    sansRdvAutorise: donnees.or.sansRdvAutorise,
    rdvRetroactifAuto: donnees.or.rdvRetroactifAuto,
    deuxOrMemeVehicule: donnees.or.deuxOrMemeVehicule,
    kmEntreeObligatoire: donnees.reception.kmEntreeObligatoire,
    kmSortieObligatoire: donnees.reception.kmSortieObligatoire,
    // ÉCART DE CONTRAT documenté côté API (`ReponseParametresAtelierDto`) : le type gelé
    // `ReponseParametresAtelier.reception.plafondDefautCentimes` annonce `number`, la valeur
    // réelle peut être `null` (« aucun plafond convenu »). Traité ici comme `number | null`
    // (voir `ChampMontant`), pas comme le type gelé littéral.
    plafondDefautCentimes: donnees.reception.plafondDefautCentimes as number | null,
    uniteTemps: donnees.travaux.uniteTemps,
    controleQualite: (CONTROLE_QUALITE_LOT1 as readonly string[]).includes(
      donnees.travaux.controleQualite,
    )
      ? (donnees.travaux.controleQualite as (typeof CONTROLE_QUALITE_LOT1)[number])
      : 'jamais',
    langueDocument: donnees.documents.langue,
    mentionSecurite: donnees.documents.mentionSecurite,
    expertiseAlerteMois: donnees.vehicule.expertiseAlerteMois,
    visibiliteHistorique: donnees.vehicule.visibiliteHistoriqueNouveauDetenteur,
  };
}

/** Construit le corps `PATCH` à partir du formulaire — n'envoie JAMAIS un domaine inerte au lot 1
 *  (`facturation.*`, `planning.*`, `reception.signature`, la plupart de `travaux.*`, voir
 *  `apps/api/src/parametrage/parametres-atelier/gouvernance-fonctionnalites.ts` : un seul champ
 *  inerte dans le corps ferait échouer TOUT le `PATCH` en `501`). `plafondDefautCentimes` : le
 *  schéma serveur n'accepte qu'un nombre (jamais `null`, écart déjà signalé) — omis du corps tant
 *  qu'il reste vide, pour ne jamais tenter d'écrire une valeur que le contrat rejette. `or.prefixe`
 *  suit la même règle, pour la même raison structurelle : `schemaModificationParametresAtelier` le
 *  déclare `z.string().trim().min(1).max(10).optional()` — un préfixe RÉELLEMENT fourni ne peut pas
 *  être vide, mais rien n'oblige à en fournir un à CHAQUE `PATCH`. L'état sorti de boîte (démo
 *  comprise : `orPrefixe` nullable en base, servi comme `prefixe: ''` par
 *  `mappeur-parametres-atelier.ts`) a un préfixe vide dès le premier chargement — l'envoyer tel
 *  quel violait `min(1)` et faisait échouer TOUT le formulaire, y compris pour modifier un champ
 *  sans rapport, avant même la moindre requête réseau (bug constaté en parcours navigateur). Omis
 *  tant qu'il reste vide, jamais envoyé comme chaîne vide.
 */
function versEntreeModification(
  valeurs: ValeursFormulaireAtelier,
): EntreeModificationParametresAtelier {
  return {
    or: {
      ...(valeurs.prefixe.trim() !== '' ? { prefixe: valeurs.prefixe } : {}),
      porteeNumerotation: valeurs.porteeNumerotation,
      resetAnnuel: valeurs.resetAnnuel,
      etatPlanifieActif: valeurs.etatPlanifieActif,
      sansRdvAutorise: valeurs.sansRdvAutorise,
      rdvRetroactifAuto: valeurs.rdvRetroactifAuto,
      deuxOrMemeVehicule: valeurs.deuxOrMemeVehicule,
    },
    reception: {
      kmEntreeObligatoire: valeurs.kmEntreeObligatoire,
      kmSortieObligatoire: valeurs.kmSortieObligatoire,
      ...(valeurs.plafondDefautCentimes !== null
        ? { plafondDefautCentimes: valeurs.plafondDefautCentimes }
        : {}),
    },
    travaux: {
      uniteTemps: valeurs.uniteTemps,
      controleQualite: valeurs.controleQualite,
    },
    documents: {
      langue: valeurs.langueDocument,
      mentionSecurite: valeurs.mentionSecurite,
    },
    vehicule: {
      expertiseAlerteMois: valeurs.expertiseAlerteMois,
      visibiliteHistoriqueNouveauDetenteur: valeurs.visibiliteHistorique,
    },
  };
}

/**
 * Paramétrage atelier (`GET|PATCH /parametres-atelier`, §8.2) — singleton du tenant, regroupé par
 * domaine. Seuls les domaines/champs ACTIFS au lot 1 sont éditables ici (`or.*`, une partie de
 * `reception.*`/`travaux.*`, `documents.*`, `vehicule.*`) — `facturation.*` et `planning.*` sont
 * intégralement INERTES au lot 1 (aucune colonne en base, `PATCH` → `501`) et n'apparaissent donc
 * PAS comme des contrôles éditables : un réglage modifiable mais sans effet serait un mensonge
 * (`gouvernance-fonctionnalites.ts`). Ils sont listés en lecture seule dans la dernière carte,
 * avec les quatre drapeaux `fonctionnalites` qui disent honnêtement ce qui n'existe pas encore.
 */
export function EcranParametrageAtelier() {
  const { t } = useTranslation(['parametrage', 'commun', 'erreurs']);
  const requete = useParametresAtelier();
  const { data: session } = useSession();
  const peutEcrire = peutModifierParametrage(session?.utilisateur.role);

  return (
    <GabaritEcran titre={t('parametrage:atelier.titre')}>
      {requete.isPending ? (
        <EtatChargement lignes={10} />
      ) : requete.isError ? (
        <EtatErreur
          titre={t('erreurs:inattendue.titre')}
          description={messageErreur(requete.error, t)}
          onReessayer={() => void requete.refetch()}
        />
      ) : (
        <FormulaireParametresAtelier donnees={requete.data} peutEcrire={peutEcrire} />
      )}
    </GabaritEcran>
  );
}

interface PropsFormulaireParametresAtelier {
  readonly donnees: ReponseParametresAtelier;
  readonly peutEcrire: boolean;
}

/**
 * Formulaire proprement dit — un composant DISTINCT de `EcranParametrageAtelier`, monté
 * UNIQUEMENT une fois `donnees` disponible (jamais pendant le chargement). C'est délibéré :
 * `useForm({ values })` de `react-hook-form` applique la valeur via un effet post-rendu, pas
 * synchroniquement au premier rendu — si ce composant existait déjà pendant le chargement
 * (`values` valant alors `undefined`), chaque `<Select>` piloté par `Controller` recevrait
 * d'abord `field.value === undefined`, un `<Select>` NON CONTRÔLÉ ; le passage ultérieur à une
 * valeur réelle bascule React en mode contrôlé — transition que Radix `Select` ne rattrape pas
 * de façon fiable (constaté : le select reste bloqué sur une chaîne vide, jamais resynchronisé,
 * y compris après la fin du rendu). Monter ce composant seulement quand `donnees` est déjà
 * connu élimine la transition non-contrôlé → contrôlé : `defaultValues` s'applique alors
 * SYNCHRONIQUEMENT au premier rendu, aucun `Select` ne voit jamais `undefined`.
 *
 * Un futur rafraîchissement de `donnees` (après enregistrement réussi) est repris par l'effet
 * `useEffect` ci-dessous, qui appelle `form.reset(...)` explicitement sur changement de
 * `donnees.version` — jamais entre `undefined` et une valeur réelle, donc jamais la même
 * transition dangereuse.
 */
function FormulaireParametresAtelier({ donnees, peutEcrire }: PropsFormulaireParametresAtelier) {
  const { t } = useTranslation(['parametrage', 'commun', 'erreurs']);
  const modifier = useModifierParametresAtelier();
  const [enregistre, setEnregistre] = useState(false);

  // Erreur de CHAMP (`or.prefixe`, seul champ à saisie libre soumis à une contrainte que l'UI ne
  // garantit pas déjà structurellement — les autres réglages passent par un `<Select>`/
  // `<Checkbox>`, jamais susceptibles de produire une valeur hors contrat) : affichée SOUS le champ
  // fautif, même discipline que `FormulaireBlocCreancier` (seul autre écran du périmètre à motiver
  // une erreur de champ locale plutôt qu'un bandeau générique). Le bandeau générique n'affiche que
  // ce qui RESTE non couvert par un message de champ — jamais la même information deux fois, mais
  // jamais non plus une erreur qui disparaîtrait faute d'être rattachée à un champ affiché ici.
  const erreurMutation = modifier.error;
  const erreurApiMutation = erreurMutation instanceof ErreurApi ? erreurMutation : undefined;
  const erreurPrefixe = erreurApiMutation?.champErreur('or.prefixe');
  const erreurGlobaleAAfficher =
    modifier.isError &&
    (!erreurApiMutation ||
      erreurApiMutation.erreursChamp.length === 0 ||
      erreurApiMutation.erreursChamp.some((e) => e.champ !== 'or.prefixe'));

  const form = useForm<ValeursFormulaireAtelier>({ defaultValues: versValeursFormulaire(donnees) });

  // Dépendance volontairement limitée à `donnees.version` : une resynchronisation sur `donnees`
  // (nouvelle référence à CHAQUE rendu du parent) réinitialiserait le formulaire en cours de
  // saisie à chaque frappe. `form` est stable (identité `react-hook-form`), `versValeursFormulaire`
  // pure — rien d'autre à lister ici.
  useEffect(() => {
    form.reset(versValeursFormulaire(donnees));
  }, [donnees.version]);

  const soumettre = form.handleSubmit((valeurs) => {
    setEnregistre(false);
    modifier.mutate(versEntreeModification(valeurs), { onSuccess: () => setEnregistre(true) });
  });

  return (
    <form onSubmit={soumettre} noValidate className="flex flex-col gap-6">
      {!peutEcrire ? (
        <Alert variant="avertissement">
          <AlertDescription>{t('parametrage:atelier.lectureSeule')}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="texte-titre-section">{t('parametrage:atelier.or.titre')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pa-prefixe">{t('parametrage:atelier.or.prefixe')}</Label>
              <Input
                id="pa-prefixe"
                maxLength={10}
                disabled={!peutEcrire}
                aria-invalid={erreurPrefixe ? true : undefined}
                aria-describedby={erreurPrefixe ? 'pa-prefixe-erreur' : undefined}
                {...form.register('prefixe')}
              />
              {erreurPrefixe ? (
                <p id="pa-prefixe-erreur" className="texte-libelle text-destructive">
                  {messageErreurChamp(erreurPrefixe, t)}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pa-portee">{t('parametrage:atelier.or.porteeNumerotation')}</Label>
              <Controller
                control={form.control}
                name="porteeNumerotation"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange} disabled={!peutEcrire}>
                    <SelectTrigger
                      id="pa-portee"
                      aria-label={t('parametrage:atelier.or.porteeNumerotation')}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PORTEES_NUMEROTATION.map((valeur) => (
                        <SelectItem key={valeur} value={valeur}>
                          {t(`parametrage:atelier.or.porteeNumerotationValeurs.${valeur}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pa-deux-or">{t('parametrage:atelier.or.deuxOrMemeVehicule')}</Label>
            <Controller
              control={form.control}
              name="deuxOrMemeVehicule"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange} disabled={!peutEcrire}>
                  <SelectTrigger
                    id="pa-deux-or"
                    className="w-full sm:w-72"
                    aria-label={t('parametrage:atelier.or.deuxOrMemeVehicule')}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {POLITIQUES_DEUX_OR_MEME_VEHICULE.map((valeur) => (
                      <SelectItem key={valeur} value={valeur}>
                        {t(`parametrage:atelier.or.deuxOrMemeVehiculeValeurs.${valeur}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <CaseACocher
            name="resetAnnuel"
            form={form}
            disabled={!peutEcrire}
            libelle={t('parametrage:atelier.or.resetAnnuel')}
          />
          <CaseACocher
            name="etatPlanifieActif"
            form={form}
            disabled={!peutEcrire}
            libelle={t('parametrage:atelier.or.etatPlanifieActif')}
          />
          <CaseACocher
            name="sansRdvAutorise"
            form={form}
            disabled={!peutEcrire}
            libelle={t('parametrage:atelier.or.sansRdvAutorise')}
          />
          <CaseACocher
            name="rdvRetroactifAuto"
            form={form}
            disabled={!peutEcrire}
            libelle={t('parametrage:atelier.or.rdvRetroactifAuto')}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="texte-titre-section">
            {t('parametrage:atelier.reception.titre')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <CaseACocher
            name="kmEntreeObligatoire"
            form={form}
            disabled={!peutEcrire}
            libelle={t('parametrage:atelier.reception.kmEntreeObligatoire')}
          />
          <CaseACocher
            name="kmSortieObligatoire"
            form={form}
            disabled={!peutEcrire}
            libelle={t('parametrage:atelier.reception.kmSortieObligatoire')}
          />
          <Controller
            control={form.control}
            name="plafondDefautCentimes"
            render={({ field }) => (
              <ChampMontant
                id="pa-plafond"
                label={t('parametrage:atelier.reception.plafondDefautCentimes')}
                disabled={!peutEcrire}
                // `field.value` peut valoir `undefined` le temps que l'option `values` de
                // `useForm` (mise à jour asynchrone à l'arrivée des données) rattrape le
                // premier rendu du formulaire — repli explicite sur `null` (`ChampMontant`
                // affiche alors un champ vide, jamais un `undefined` qui le ferait planter).
                valeurCentimes={field.value ?? null}
                onChangeCentimes={field.onChange}
                className="max-w-xs"
              />
            )}
          />
          <p className="texte-libelle text-muted-foreground">
            {t('parametrage:atelier.reception.plafondDefautAide')}
          </p>
          <ChampInerte
            libelle={t('parametrage:atelier.reception.signature')}
            raison={t('parametrage:atelier.inerte.signature')}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="texte-titre-section">
            {t('parametrage:atelier.travaux.titre')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pa-unite-temps">{t('parametrage:atelier.travaux.uniteTemps')}</Label>
              <Controller
                control={form.control}
                name="uniteTemps"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange} disabled={!peutEcrire}>
                    <SelectTrigger
                      id="pa-unite-temps"
                      aria-label={t('parametrage:atelier.travaux.uniteTemps')}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {UNITES_TEMPS.map((valeur) => (
                        <SelectItem key={valeur} value={valeur}>
                          {t(`parametrage:atelier.travaux.uniteTempsValeurs.${valeur}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pa-controle-qualite">
                {t('parametrage:atelier.travaux.controleQualite')}
              </Label>
              <Controller
                control={form.control}
                name="controleQualite"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange} disabled={!peutEcrire}>
                    <SelectTrigger
                      id="pa-controle-qualite"
                      aria-label={t('parametrage:atelier.travaux.controleQualite')}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONTROLE_QUALITE_LOT1.map((valeur) => (
                        <SelectItem key={valeur} value={valeur}>
                          {t(`parametrage:atelier.travaux.controleQualiteValeurs.${valeur}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>
          <ChampInerte
            libelle={t('parametrage:atelier.travaux.pointage')}
            raison={t('parametrage:atelier.inerte.pointage')}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="texte-titre-section">
            {t('parametrage:atelier.documents.titre')}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pa-langue-doc">{t('parametrage:atelier.documents.langue')}</Label>
            <Controller
              control={form.control}
              name="langueDocument"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange} disabled={!peutEcrire}>
                  <SelectTrigger
                    id="pa-langue-doc"
                    aria-label={t('parametrage:atelier.documents.langue')}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {POLITIQUES_LANGUE_DOCUMENT.map((valeur) => (
                      <SelectItem key={valeur} value={valeur}>
                        {t(`parametrage:atelier.documents.langueValeurs.${valeur}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pa-mention-securite">
              {t('parametrage:atelier.documents.mentionSecurite')}
            </Label>
            <Controller
              control={form.control}
              name="mentionSecurite"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange} disabled={!peutEcrire}>
                  <SelectTrigger
                    id="pa-mention-securite"
                    aria-label={t('parametrage:atelier.documents.mentionSecurite')}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {POLITIQUES_MENTION_SECURITE.map((valeur) => (
                      <SelectItem key={valeur} value={valeur}>
                        {t(`parametrage:atelier.documents.mentionSecuriteValeurs.${valeur}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="texte-titre-section">
            {t('parametrage:atelier.vehicule.titre')}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pa-expertise-alerte">
              {t('parametrage:atelier.vehicule.expertiseAlerteMois')}
            </Label>
            <Input
              id="pa-expertise-alerte"
              type="number"
              min={0}
              max={24}
              disabled={!peutEcrire}
              {...form.register('expertiseAlerteMois', { valueAsNumber: true })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pa-visibilite">
              {t('parametrage:atelier.vehicule.visibiliteHistorique')}
            </Label>
            <Controller
              control={form.control}
              name="visibiliteHistorique"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange} disabled={!peutEcrire}>
                  <SelectTrigger
                    id="pa-visibilite"
                    aria-label={t('parametrage:atelier.vehicule.visibiliteHistorique')}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VISIBILITES_HISTORIQUE_VEHICULE.map((valeur) => (
                      <SelectItem key={valeur} value={valeur}>
                        {t(`parametrage:atelier.vehicule.visibiliteHistoriqueValeurs.${valeur}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="texte-titre-section">
            {t('parametrage:atelier.aVenir.titre')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="texte-corps text-muted-foreground">
            {t('parametrage:atelier.aVenir.description')}
          </p>
          <ul className="space-y-1.5">
            {(['facturation', 'stockPieces', 'depotPneus', 'prets'] as const).map((cle) => (
              <li key={cle} className="flex items-center gap-2 texte-corps">
                <Badge variant="outline">
                  {t(`parametrage:atelier.aVenir.fonctionnalites.${cle}`)}
                </Badge>
                <span className="text-muted-foreground">
                  {t('parametrage:atelier.aVenir.pasEncoreDisponible')}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {erreurGlobaleAAfficher ? (
        <Alert variant="destructive">
          <AlertTitle>{t('erreurs:inattendue.titre')}</AlertTitle>
          <AlertDescription>{messageErreur(erreurMutation, t)}</AlertDescription>
        </Alert>
      ) : null}

      {peutEcrire ? (
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={modifier.isPending}>
            {modifier.isPending ? t('commun:chargement.enCours') : t('commun:actions.enregistrer')}
          </Button>
          {enregistre && !modifier.isPending ? (
            <span className="flex items-center gap-1.5 texte-corps text-foreground">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              {t('parametrage:atelier.enregistrementReussi')}
            </span>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}

interface PropsCaseACocher {
  readonly name: keyof Pick<
    ValeursFormulaireAtelier,
    | 'resetAnnuel'
    | 'etatPlanifieActif'
    | 'sansRdvAutorise'
    | 'rdvRetroactifAuto'
    | 'kmEntreeObligatoire'
    | 'kmSortieObligatoire'
  >;
  readonly form: ReturnType<typeof useForm<ValeursFormulaireAtelier>>;
  readonly disabled: boolean;
  readonly libelle: string;
}

function CaseACocher({ name, form, disabled, libelle }: PropsCaseACocher) {
  const id = `param-atelier-${name}`;
  return (
    <Controller
      control={form.control}
      name={name}
      render={({ field }) => (
        <label htmlFor={id} className="flex items-center gap-2 texte-corps">
          <Checkbox
            id={id}
            checked={field.value}
            onCheckedChange={(coche) => field.onChange(coche === true)}
            disabled={disabled}
          />
          {libelle}
        </label>
      )}
    />
  );
}

/** Réglage lu depuis l'API mais INERTE au lot 1 (aucun contrôle éditable — un contrôle modifiable
 *  sans effet serait un mensonge, voir l'en-tête de l'écran) : affiché en lecture seule avec la
 *  raison, jamais une case grisée qui laisserait croire à une limitation technique passagère. */
function ChampInerte({ libelle, raison }: { readonly libelle: string; readonly raison: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed p-3 texte-corps text-muted-foreground">
      <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>
        {libelle} — {raison}
      </span>
    </div>
  );
}
