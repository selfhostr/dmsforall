import { CheckCircle2, Lock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import {
  METHODES_PRIX_ACHAT,
  type MethodePrixAchat,
  type ReponseParametresPieces,
} from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { useModifierParametresPieces } from '@/hooks/pieces/useModifierParametresPieces';
import type { EntreeModificationParametresPieces } from '@/hooks/pieces/useModifierParametresPieces';
import { useParametresPieces } from '@/hooks/pieces/useParametresPieces';
import { useSession } from '@/hooks/useSession';

import { peutModifierParametragePieces } from '../pieces/droits';

/** Sentinelle pour représenter `null` dans un `<Select>` Radix (qui n'accepte pas la valeur `''`
 *  comme item) — même convention que `DialoguePrestation.tsx` (`AUCUN`). `methodePrixAchat` reste
 *  `null` TANT QUE `QP-04` n'est pas arbitré (voir `contrats/pieces/parametrage.ts`) : ce n'est pas
 *  une valeur par défaut inventée, l'absence de choix est un état légitime et durable. */
const AUCUNE_METHODE = '__aucune__';

/** TVA suisse — mêmes quatre taux que `FormulaireArticle.tsx` (`TAUX_TVA_SUISSES`), dupliqués ici
 *  plutôt qu'importés : pas assez de matière pour justifier un fichier partagé, même doctrine que
 *  le reste du module pièces (voir `ecrans/pieces/utils.ts`). */
const TAUX_TVA_SUISSES = [81, 26, 38, 0] as const;

interface ValeursFormulairePieces {
  readonly stockAutresSitesVisible: boolean;
  readonly stockNegatifForcageAutorise: boolean;
  readonly methodePrixAchat: MethodePrixAchat | typeof AUCUNE_METHODE;
  readonly seuilValeurAjustementSignificatifCentimes: number | null;
  readonly delaiConsigneAcquisitionJours: number | null;
  readonly tauxTvaConsignePourmille: number;
}

function versValeursFormulaire(donnees: ReponseParametresPieces): ValeursFormulairePieces {
  return {
    stockAutresSitesVisible: donnees.stockAutresSitesVisible,
    stockNegatifForcageAutorise: donnees.stockNegatifForcageAutorise,
    methodePrixAchat: donnees.methodePrixAchat ?? AUCUNE_METHODE,
    seuilValeurAjustementSignificatifCentimes: donnees.seuilValeurAjustementSignificatifCentimes,
    delaiConsigneAcquisitionJours: donnees.delaiConsigneAcquisitionJours,
    tauxTvaConsignePourmille: donnees.tauxTvaConsignePourmille,
  };
}

/** `conditionnementArticleDistinct` ABSENT du corps envoyé, à l'identique du schéma serveur
 *  (`schemaModificationParametresPieces` ne le porte pas — voir le commentaire du contrat) : ce
 *  n'est pas un réglage tenant, l'écran ne l'affiche qu'en lecture. Les trois champs `null`
 *  possibles sont envoyés EXPLICITEMENT tels quels (jamais omis) — contrairement à
 *  `EcranParametrageAtelier.plafondDefautCentimes`, le schéma serveur ACCEPTE `null` ici
 *  (`.nullish()`), donc effacer un champ dans ce formulaire efface réellement la valeur en base.
 */
function versEntreeModification(
  valeurs: ValeursFormulairePieces,
): EntreeModificationParametresPieces {
  return {
    stockAutresSitesVisible: valeurs.stockAutresSitesVisible,
    stockNegatifForcageAutorise: valeurs.stockNegatifForcageAutorise,
    methodePrixAchat: valeurs.methodePrixAchat === AUCUNE_METHODE ? null : valeurs.methodePrixAchat,
    seuilValeurAjustementSignificatifCentimes: valeurs.seuilValeurAjustementSignificatifCentimes,
    delaiConsigneAcquisitionJours: valeurs.delaiConsigneAcquisitionJours,
    tauxTvaConsignePourmille: valeurs.tauxTvaConsignePourmille,
  };
}

/**
 * Paramétrage du domaine pièces (`GET|PATCH /parametrage/pieces`, §10 `PP-01` → `PP-08`) —
 * singleton du tenant, jusqu'ici réglable UNIQUEMENT en base (aucun hook, aucun écran, aucune
 * route ne l'exposait). Gardé par `pieces.parametrage.lire`/`pieces.parametrage.modifier`,
 * accordés à `direction`/`chef_atelier`/`magasinier` en LECTURE mais `direction`/`chef_atelier`
 * SEULS en ÉCRITURE (`apps/api/src/auth/matrice-droits.ts`) — restriction RÉELLE de l'API,
 * reflétée par `RouteProtegee rolesAutorises={ROLES_PARAMETRAGE_PIECES}` dans `routeur.tsx`
 * (contrairement à `parametrage/atelier`, ouvert à tout rôle authentifié).
 *
 * Même construction que `EcranParametrageAtelier`/`EcranSites` : le formulaire n'est monté
 * qu'une fois les données arrivées (`FormulaireParametresPieces` ci-dessous), pour ne jamais
 * faire transiter un `<Select>` Radix piloté par `Controller` par un premier état `undefined`
 * (transition non-contrôlé -> contrôlé que Radix ne rattrape pas fiablement, déjà constaté sur
 * l'écran atelier).
 */
export function EcranParametragePieces() {
  const { t } = useTranslation(['parametrage', 'pieces', 'commun', 'erreurs']);
  const requete = useParametresPieces();
  const { data: session } = useSession();
  const peutEcrire = peutModifierParametragePieces(session?.actions);

  return (
    <GabaritEcran titre={t('parametrage:pieces.titre')}>
      {requete.isPending ? (
        <EtatChargement lignes={8} />
      ) : requete.isError ? (
        <EtatErreur
          titre={t('parametrage:pieces.erreur.titre')}
          description={messageErreur(requete.error, t)}
          onReessayer={() => void requete.refetch()}
        />
      ) : (
        <FormulaireParametresPieces
          donnees={requete.data}
          // Pas de champ `version` dans ce contrat (à la différence de
          // `ReponseParametresAtelier`/`ReponseParametresSite`) — `dataUpdatedAt` de TanStack
          // Query joue le même rôle de dépendance stable pour l'effet de resynchronisation
          // ci-dessous : il ne change qu'au chargement initial et après un `setQueryData` réussi
          // (`useModifierParametresPieces`), jamais à chaque rendu du parent.
          chargeLe={requete.dataUpdatedAt}
          peutEcrire={peutEcrire}
        />
      )}
    </GabaritEcran>
  );
}

interface PropsFormulaireParametresPieces {
  readonly donnees: ReponseParametresPieces;
  readonly chargeLe: number;
  readonly peutEcrire: boolean;
}

function FormulaireParametresPieces({
  donnees,
  chargeLe,
  peutEcrire,
}: PropsFormulaireParametresPieces) {
  const { t } = useTranslation(['parametrage', 'pieces', 'commun', 'erreurs']);
  const modifier = useModifierParametresPieces();
  const [enregistre, setEnregistre] = useState(false);

  const form = useForm<ValeursFormulairePieces>({
    defaultValues: versValeursFormulaire(donnees),
  });

  useEffect(() => {
    form.reset(versValeursFormulaire(donnees));
    // Dépendance volontairement limitée à `chargeLe` — voir le commentaire ci-dessus : `form` est
    // stable et `versValeursFormulaire` est pure. L'effet se redéclenchera seulement au chargement
    // initial et après modification, jamais à chaque rendu du parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chargeLe]);

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
          <CardTitle className="texte-titre-section">
            {t('parametrage:pieces.stock.titre')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <CaseACocher
            name="stockAutresSitesVisible"
            form={form}
            disabled={!peutEcrire}
            libelle={t('parametrage:pieces.stock.stockAutresSitesVisible')}
          />
          <CaseACocher
            name="stockNegatifForcageAutorise"
            form={form}
            disabled={!peutEcrire}
            libelle={t('parametrage:pieces.stock.stockNegatifForcageAutorise')}
          />
          <ChampInerte
            libelle={t('parametrage:pieces.conditionnement.articleDistinct')}
            raison={t('parametrage:pieces.conditionnement.inerte')}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="texte-titre-section">
            {t('parametrage:pieces.valorisation.titre')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pp-methode-prix">
              {t('parametrage:pieces.valorisation.methodePrixAchat')}
            </Label>
            <Controller
              control={form.control}
              name="methodePrixAchat"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange} disabled={!peutEcrire}>
                  <SelectTrigger
                    id="pp-methode-prix"
                    className="w-full sm:w-80"
                    aria-label={t('parametrage:pieces.valorisation.methodePrixAchat')}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={AUCUNE_METHODE}>
                      {t('parametrage:pieces.valorisation.methodePrixAchatValeurs.aucune')}
                    </SelectItem>
                    {METHODES_PRIX_ACHAT.map((valeur) => (
                      <SelectItem key={valeur} value={valeur}>
                        {t(`parametrage:pieces.valorisation.methodePrixAchatValeurs.${valeur}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          <p className="texte-libelle text-muted-foreground">
            {t('parametrage:pieces.valorisation.methodePrixAchatAide')}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="texte-titre-section">
            {t('parametrage:pieces.inventaire.titre')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Controller
            control={form.control}
            name="seuilValeurAjustementSignificatifCentimes"
            render={({ field }) => (
              <ChampMontant
                id="pp-seuil-ajustement"
                label={t('parametrage:pieces.inventaire.seuilValeurAjustementSignificatif')}
                disabled={!peutEcrire}
                valeurCentimes={field.value}
                onChangeCentimes={field.onChange}
                className="max-w-xs"
              />
            )}
          />
          <p className="texte-libelle text-muted-foreground">
            {t('parametrage:pieces.inventaire.seuilValeurAjustementSignificatifAide')}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="texte-titre-section">
            {t('parametrage:pieces.consigne.titre')}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pp-delai-consigne">
              {t('parametrage:pieces.consigne.delaiAcquisitionJours')}
            </Label>
            <Controller
              control={form.control}
              name="delaiConsigneAcquisitionJours"
              render={({ field }) => (
                <Input
                  id="pp-delai-consigne"
                  type="number"
                  min={0}
                  max={3650}
                  disabled={!peutEcrire}
                  value={field.value ?? ''}
                  onChange={(evenement) => {
                    const brut = evenement.target.value;
                    field.onChange(brut === '' ? null : Number(brut));
                  }}
                />
              )}
            />
            <p className="texte-libelle text-muted-foreground">
              {t('parametrage:pieces.consigne.delaiAcquisitionJoursAide')}
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pp-tva-consigne">{t('parametrage:pieces.consigne.tauxTva')}</Label>
            <Controller
              control={form.control}
              name="tauxTvaConsignePourmille"
              render={({ field }) => (
                <Select
                  value={String(field.value)}
                  onValueChange={(valeur) => field.onChange(Number(valeur))}
                  disabled={!peutEcrire}
                >
                  <SelectTrigger
                    id="pp-tva-consigne"
                    aria-label={t('parametrage:pieces.consigne.tauxTva')}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TAUX_TVA_SUISSES.map((pourmille) => (
                      <SelectItem key={pourmille} value={String(pourmille)}>
                        {t(`pieces:articles.tauxTvaLibelles.${pourmille}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
        </CardContent>
      </Card>

      {modifier.isError ? (
        <Alert variant="destructive">
          <AlertTitle>{t('erreurs:inattendue.titre')}</AlertTitle>
          <AlertDescription>{messageErreur(modifier.error, t)}</AlertDescription>
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
              {t('parametrage:pieces.enregistrementReussi')}
            </span>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}

interface PropsCaseACocher {
  readonly name: keyof Pick<
    ValeursFormulairePieces,
    'stockAutresSitesVisible' | 'stockNegatifForcageAutorise'
  >;
  readonly form: ReturnType<typeof useForm<ValeursFormulairePieces>>;
  readonly disabled: boolean;
  readonly libelle: string;
}

function CaseACocher({ name, form, disabled, libelle }: PropsCaseACocher) {
  const id = `param-pieces-${name}`;
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

/** Réglage lu depuis l'API mais INERTE (`conditionnementArticleDistinct`, hypothèse figée `RP-05`
 *  tant que `QP-03` n'est pas tranché — voir `contrats/pieces/parametrage.ts`) : affiché en
 *  lecture seule avec la raison, même patron que `ChampInerte` dans `EcranParametrageAtelier.tsx`
 *  (dupliqué plutôt que partagé — pas assez de matière commune pour un composant générique). */
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
