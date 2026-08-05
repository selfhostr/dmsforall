import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm, type DefaultValues, type FieldPath } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import type { z } from 'zod';

import { schemaCreationClient, type EntreeCreationClient, type TypeClient } from '@dfa/shared';

import { ErreurApi, ErreurReseau, messageErreur, messageErreurChamp } from '@/api/erreurs';
import { useCleIdempotence } from '@/api/idempotence';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AvertissementConfirmable } from '@/composants/motifs/AvertissementConfirmable';
import { useCreerClient } from '@/hooks/clients/useCreerClient';
import { useDoublonsClients } from '@/hooks/clients/useDoublonsClients';
import { useLangue } from '@/hooks/useLangue';
import { cn } from '@/lib/utils';
import { chemins } from '@/routes/chemins';

interface Props {
  /** État d'ouverture du tiroir qui héberge ce formulaire (`EcranListeClients`). Piloté par le
   *  PARENT (jamais interne) : sert de déclencheur à la réinitialisation ci-dessous, exactement
   *  comme `DialogueModifierDossierVente` (`ecrans/ventes/dossiers/`) — même patron, copié plutôt
   *  que réinventé. Sans lui, une tentative échouée laisse ses valeurs dans le formulaire : la
   *  même instance de tiroir peut rester montée d'une ouverture à l'autre (fermeture puis
   *  réouverture rapides, avant la fin de l'animation de sortie de `SheetContent`), et une
   *  nouvelle saisie s'insère alors dans l'ancienne plutôt que de la remplacer — défaut réel
   *  constaté en test navigateur, avec un client corrompu créé en base. */
  readonly ouvert: boolean;
  readonly onCree: (clientId: string) => void;
}

/** Transforme une saisie vide en `undefined` — nécessaire pour tout champ
 *  `schemaTexteCourt.nullish()` (`@dfa/shared`) : `nullish()` accepte `null`/`undefined`, jamais
 *  une chaîne vide (qui échoue `min(1)`). Sans ce garde-fou, un champ facultatif laissé vide
 *  produirait une erreur de validation plutôt que d'être simplement omis. */
function videVersIndefini(valeur: string): string | undefined {
  return valeur === '' ? undefined : valeur;
}

/** Valeurs SAISIES (pré-validation zod) du formulaire, PAS `EntreeCreationClient` (le résultat
 *  APRÈS transformation zod — `.default()`, `.superRefine()` appliqués). `zodResolver` (zod 4,
 *  `@hookform/resolvers/zod`) type le formulaire sur `z.input<Schema>` pour les valeurs de champ
 *  et sur `z.output<Schema>` (= `EntreeCreationClient`) uniquement pour le résultat transmis à
 *  `handleSubmit` — les deux DIVERGENT dès qu'un champ porte `.default(...)` (ex. `poObligatoire`,
 *  `telephones`) : optionnel en entrée, garanti présent en sortie. Utiliser `EntreeCreationClient`
 *  ici (comme avant l'ajout de `.superRefine(validerNpaSelonPays)` sur `adressePrincipale`,
 *  packages/shared/src/contrats/atelier/client.ts) fait diverger le type déduit de `useForm` de
 *  celui produit par `zodResolver`, et `tsc` refuse la valeur de retour du resolver. */
type ValeursSaisieFormulaire = z.input<typeof schemaCreationClient>;

/** Valeurs par défaut du formulaire — fonction, pas un objet constant : `langueCorrespondance`
 *  dépend de la langue courante au moment de l'appel, et cette fonction est réappelée à CHAQUE
 *  ouverture du tiroir (voir l'effet de réinitialisation ci-dessous), pas seulement au montage.
 *
 *  Retour explicitement typé `DefaultValues<ValeursSaisieFormulaire>` : sans cette annotation, TS
 *  infère le type de retour depuis le seul littéral (`type: 'particulier'` resterait figé, pas
 *  élargi à `TypeClient`), et `useForm<T>` infère alors T depuis ce littéral trop étroit plutôt
 *  que depuis `zodResolver(schemaCreationClient)` — tout le formulaire perd `nom`, `email`, `ide`,
 *  etc. (absents des valeurs par défaut, donc absents du type déduit). */
function valeursParDefaut(
  langueCourante: EntreeCreationClient['langueCorrespondance'],
): DefaultValues<ValeursSaisieFormulaire> {
  return {
    type: 'particulier',
    langueCorrespondance: langueCourante,
    adressePrincipale: { rue: '', npa: '', localite: '', pays: 'CH' },
    telephones: [],
    poObligatoire: false,
  };
}

/**
 * Formulaire de création client (RM-01, RM-05) — au comptoir, pas d'assistant multi-étapes :
 * un seul écran, l'identité minimale + adresse + un moyen de contact. Les champs avancés
 * (conditions commerciales, groupe, PO obligatoire) restent modifiables depuis la fiche après
 * création, hors périmètre de ce formulaire de première saisie.
 *
 * Doublon (RM-05, CT-01) : aperçu live non bloquant (`useDoublonsClients`, debounce 400 ms) sous
 * les champs d'identité, PUIS confirmation en deux temps à la soumission si des candidats
 * subsistent (`AvertissementConfirmable`, jamais `RefusBloquant` — deux frères à la même adresse
 * restent deux clients légitimes).
 */
export function FormulaireNouveauClient({ ouvert, onCree }: Props) {
  const { t } = useTranslation(['clients', 'commun', 'validation', 'erreurs']);
  const { langue: langueCourante, languesDisponibles } = useLangue();
  const idempotence = useCleIdempotence();
  const creerClient = useCreerClient();
  // Rendu sous la même route que EcranListeClients (sheet) : mêmes paramètres de requête, même
  // règle (routes/chemins.ts) — le lien « Voir » vers un doublon ne doit pas faire perdre le site.
  const [searchParams] = useSearchParams();
  const site = searchParams.get('site') ?? undefined;

  const [telephoneSaisi, setTelephoneSaisi] = useState('');
  const [entreeEnAttente, setEntreeEnAttente] = useState<EntreeCreationClient | null>(null);
  const [criteres, setCriteres] = useState<{
    nom?: string;
    npa?: string;
    email?: string;
    telephoneMobile?: string;
    ide?: string;
  }>({});

  // Générique explicite (`ValeursSaisieFormulaire`, puis `unknown` pour le contexte, puis
  // `EntreeCreationClient` pour les valeurs TRANSFORMÉES reçues par `handleSubmit`) : voir le
  // commentaire de `ValeursSaisieFormulaire` ci-dessus. Sans lui, `tsc` doit choisir entre le
  // type déduit de `resolver` (entrée) et celui de `defaultValues` (qui pourrait, par erreur,
  // redevenir la sortie) — les rendre explicites élimine toute ambiguïté d'inférence.
  const form = useForm<ValeursSaisieFormulaire, unknown, EntreeCreationClient>({
    resolver: zodResolver(schemaCreationClient),
    defaultValues: valeursParDefaut(langueCourante),
  });

  useEffect(() => {
    if (!ouvert) return;
    form.reset(valeursParDefaut(langueCourante));
    setTelephoneSaisi('');
    setEntreeEnAttente(null);
    setCriteres({});
    creerClient.reset();
    idempotence.regenerer();
    // Réinitialise à CHAQUE ouverture (pas seulement au montage) : même patron que
    // `DialogueModifierDossierVente` (ecrans/ventes/dossiers/) — la même instance de tiroir peut
    // rester montée d'une fermeture à l'autre (ex. fermeture puis réouverture avant la fin de
    // l'animation de sortie de `SheetContent`), et sans cet effet une tentative échouée laisse ses
    // valeurs dans le formulaire : la saisie suivante s'insère dans l'ancienne au lieu de la
    // remplacer (défaut réel constaté en test navigateur, client corrompu créé en base).
    // `idempotence.regenerer()` fait partie de cette réinitialisation : une réouverture est un
    // abandon explicite de la tentative précédente (api/idempotence.ts, en-tête du fichier), la
    // clé ne doit donc pas survivre — sinon une nouvelle saisie, distincte, rejouerait l'ancienne
    // clé et le serveur la refuserait comme `IDEMPOTENCE_CONFLIT`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ouvert]);

  const type = form.watch('type');
  const nom = form.watch('nom');
  const raisonSociale = form.watch('raisonSociale');
  const npa = form.watch('adressePrincipale.npa');
  const email = form.watch('email');
  const ide = form.watch('ide');

  useEffect(() => {
    const identifiant = setTimeout(() => {
      setCriteres({
        nom: (type === 'entreprise' ? raisonSociale : nom) || undefined,
        npa: npa || undefined,
        email: email || undefined,
        telephoneMobile: telephoneSaisi || undefined,
        ide: ide || undefined,
      });
    }, 400);
    return () => clearTimeout(identifiant);
  }, [type, nom, raisonSociale, npa, email, telephoneSaisi, ide]);

  const doublons = useDoublonsClients(criteres);
  const candidats = doublons.data?.candidats ?? [];
  const premierCandidat = candidats[0];

  const creer = (entree: EntreeCreationClient) => {
    creerClient.mutate(
      { entree, idempotencyKey: idempotence.cle },
      {
        onSuccess: (reponse) => {
          idempotence.regenerer();
          onCree(reponse.donnees.id);
        },
        onError: (erreurMutation) => {
          // §3.5 règle 5 : une erreur de champ (`ProblemeDetail.erreurs[]`) est réinjectée dans
          // react-hook-form pour s'afficher SOUS le champ fautif, exactement comme une erreur de
          // validation locale — au lieu de mourir dans le bandeau générique ci-dessous. Défaut réel
          // constaté en test navigateur : un IDE ou une adresse refusés par le serveur (doublon
          // d'adresse active, format zod) ne montraient RIEN sur le champ concerné, seulement
          // « Certaines informations sont incorrectes. » en haut de formulaire.
          if (erreurMutation instanceof ErreurApi) {
            for (const champErreur of erreurMutation.erreursChamp) {
              form.setError(champErreur.champ as FieldPath<ValeursSaisieFormulaire>, {
                type: 'server',
                message: messageErreurChamp(champErreur, t),
              });
            }
          }
        },
      },
    );
  };

  const soumettre = form.handleSubmit((valeurs) => {
    const entree: EntreeCreationClient = {
      ...valeurs,
      telephones: telephoneSaisi.trim() ? [{ valeur: telephoneSaisi.trim(), principal: true }] : [],
    };
    if (candidats.length > 0) {
      setEntreeEnAttente(entree);
      return;
    }
    creer(entree);
  });

  const confirmerMalgreDoublon = () => {
    if (entreeEnAttente) creer(entreeEnAttente);
    setEntreeEnAttente(null);
  };

  const enCours = creerClient.isPending;
  const erreur = creerClient.error;
  const estErreurReseau = erreur instanceof ErreurReseau;

  return (
    <form onSubmit={soumettre} noValidate className="mt-6 space-y-5">
      {erreur ? (
        <Alert variant={estErreurReseau ? 'avertissement' : 'destructive'}>
          {estErreurReseau ? (
            <WifiOff className="h-4 w-4" aria-hidden="true" />
          ) : (
            <AlertCircle className="h-4 w-4" aria-hidden="true" />
          )}
          <AlertTitle>
            {t(estErreurReseau ? 'erreurs:reseau.titre' : 'erreurs:inattendue.titre')}
          </AlertTitle>
          <AlertDescription>{messageErreur(erreur, t)}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label>{t('clients:liste.filtres.type')}</Label>
        <div role="group" className="inline-flex overflow-hidden rounded-md border">
          {(['particulier', 'entreprise'] as const satisfies readonly TypeClient[]).map(
            (valeur) => (
              <button
                key={valeur}
                type="button"
                aria-pressed={type === valeur}
                onClick={() => form.setValue('type', valeur, { shouldValidate: true })}
                className={cn(
                  'h-11 px-4 texte-corps font-medium transition-colors',
                  type === valeur
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background text-foreground hover:bg-muted',
                )}
              >
                {t(`clients:liste.types.${valeur}`)}
              </button>
            ),
          )}
        </div>
      </div>

      {type === 'particulier' ? (
        // `key` DISTINCT du bloc « entreprise » ci-dessous : sans lui, React voit deux `<Input>`
        // non contrôlés à la MÊME position d'arbre lors du basculement de `type` (ex. après
        // `form.reset()` à la réouverture, défaut 1) et réutilise le NŒUD DOM existant plutôt que
        // d'en monter un nouveau — l'ancien texte tapé dans « Raison sociale » restait alors
        // visible comme valeur brute de l'input « Nom » (React ne réinitialise jamais `.value`
        // d'un champ non contrôlé lors d'une simple mise à jour de props). Constaté en écrivant le
        // test de non-régression du défaut 1 : sans ce `key`, il échouait avec exactement ce
        // symptôme, sur un champ pourtant déjà vidé par `form.reset()`.
        <div key="identite-particulier" className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="nc-nom">{t('clients:identite.nom')}</Label>
            <Input
              id="nc-nom"
              readOnly={enCours}
              aria-invalid={form.formState.errors.nom ? true : undefined}
              aria-describedby={form.formState.errors.nom ? 'nc-nom-erreur' : undefined}
              {...form.register('nom', { setValueAs: videVersIndefini })}
            />
            {form.formState.errors.nom ? (
              <p id="nc-nom-erreur" className="text-sm text-destructive">
                {form.formState.errors.nom.type === 'server'
                  ? form.formState.errors.nom.message
                  : t('validation:requis')}
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="nc-prenom">{t('clients:identite.prenom')}</Label>
            <Input
              id="nc-prenom"
              readOnly={enCours}
              {...form.register('prenom', { setValueAs: videVersIndefini })}
            />
          </div>
        </div>
      ) : (
        <div key="identite-entreprise" className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="nc-raison-sociale">{t('clients:identite.raisonSociale')}</Label>
            <Input
              id="nc-raison-sociale"
              readOnly={enCours}
              aria-invalid={form.formState.errors.raisonSociale ? true : undefined}
              aria-describedby={
                form.formState.errors.raisonSociale ? 'nc-raison-sociale-erreur' : undefined
              }
              {...form.register('raisonSociale', { setValueAs: videVersIndefini })}
            />
            {form.formState.errors.raisonSociale ? (
              <p id="nc-raison-sociale-erreur" className="text-sm text-destructive">
                {form.formState.errors.raisonSociale.type === 'server'
                  ? form.formState.errors.raisonSociale.message
                  : t('validation:requis')}
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="nc-ide">{t('clients:identite.ide')}</Label>
            <Input
              id="nc-ide"
              readOnly={enCours}
              placeholder="CHE-123.456.789"
              aria-invalid={form.formState.errors.ide ? true : undefined}
              aria-describedby={form.formState.errors.ide ? 'nc-ide-erreur' : undefined}
              {...form.register('ide', { setValueAs: videVersIndefini })}
            />
            {form.formState.errors.ide ? (
              // Défaut 2 corrigé ici : un IDE mal formé (ex. « 12345 ») échouait `schemaIde`
              // (regex zod) SANS jamais afficher son erreur — `handleSubmit` refuse silencieusement
              // de soumettre (aucune requête réseau), et rien ne le montre au garagiste. Le message
              // zod natif n'étant pas traduit (§ commentaire de `messageErreurChamp`), on retombe
              // sur le générique existant plutôt que d'afficher un texte anglais brut.
              <p id="nc-ide-erreur" className="text-sm text-destructive">
                {form.formState.errors.ide.type === 'server'
                  ? form.formState.errors.ide.message
                  : t('erreurs:codes.VALIDATION_ECHOUEE')}
              </p>
            ) : null}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="nc-langue">{t('clients:identite.langue')}</Label>
        <Select
          value={form.watch('langueCorrespondance')}
          onValueChange={(valeur) =>
            form.setValue(
              'langueCorrespondance',
              valeur as EntreeCreationClient['langueCorrespondance'],
            )
          }
        >
          <SelectTrigger id="nc-langue" aria-label={t('clients:identite.langue')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {languesDisponibles.map((code) => (
              <SelectItem key={code} value={code}>
                {t(`commun:langues.${code}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="nc-telephone">{t('clients:identite.telephone')}</Label>
          <Input
            id="nc-telephone"
            type="tel"
            readOnly={enCours}
            value={telephoneSaisi}
            onChange={(evenement) => setTelephoneSaisi(evenement.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="nc-email">{t('clients:identite.email')}</Label>
          <Input
            id="nc-email"
            type="email"
            readOnly={enCours}
            aria-invalid={form.formState.errors.email ? true : undefined}
            aria-describedby={form.formState.errors.email ? 'nc-email-erreur' : undefined}
            {...form.register('email', { setValueAs: videVersIndefini })}
          />
          {form.formState.errors.email ? (
            <p id="nc-email-erreur" className="text-sm text-destructive">
              {form.formState.errors.email.type === 'server'
                ? form.formState.errors.email.message
                : t('validation:email.invalide')}
            </p>
          ) : null}
        </div>
      </div>

      <fieldset className="space-y-3 rounded-md border p-3">
        <legend className="px-1 texte-libelle font-medium text-foreground">
          {t('clients:adresses.types.principale')}
        </legend>
        <div className="space-y-2">
          <Label htmlFor="nc-rue">{t('clients:adresses.champs.rue')}</Label>
          <Input
            id="nc-rue"
            readOnly={enCours}
            aria-invalid={form.formState.errors.adressePrincipale?.rue ? true : undefined}
            aria-describedby={
              form.formState.errors.adressePrincipale?.rue ? 'nc-rue-erreur' : undefined
            }
            {...form.register('adressePrincipale.rue')}
          />
          {form.formState.errors.adressePrincipale?.rue ? (
            <p id="nc-rue-erreur" className="text-sm text-destructive">
              {form.formState.errors.adressePrincipale.rue.type === 'server'
                ? form.formState.errors.adressePrincipale.rue.message
                : t('validation:requis')}
            </p>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="nc-npa">{t('clients:adresses.champs.npa')}</Label>
            <Input
              id="nc-npa"
              readOnly={enCours}
              aria-invalid={form.formState.errors.adressePrincipale?.npa ? true : undefined}
              aria-describedby={
                form.formState.errors.adressePrincipale?.npa ? 'nc-npa-erreur' : undefined
              }
              {...form.register('adressePrincipale.npa')}
            />
            {form.formState.errors.adressePrincipale?.npa ? (
              <p id="nc-npa-erreur" className="text-sm text-destructive">
                {form.formState.errors.adressePrincipale.npa.type === 'server'
                  ? form.formState.errors.adressePrincipale.npa.message
                  : t('validation:requis')}
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="nc-localite">{t('clients:adresses.champs.localite')}</Label>
            <Input
              id="nc-localite"
              readOnly={enCours}
              aria-invalid={form.formState.errors.adressePrincipale?.localite ? true : undefined}
              aria-describedby={
                form.formState.errors.adressePrincipale?.localite ? 'nc-localite-erreur' : undefined
              }
              {...form.register('adressePrincipale.localite')}
            />
            {form.formState.errors.adressePrincipale?.localite ? (
              <p id="nc-localite-erreur" className="text-sm text-destructive">
                {form.formState.errors.adressePrincipale.localite.type === 'server'
                  ? form.formState.errors.adressePrincipale.localite.message
                  : t('validation:requis')}
              </p>
            ) : null}
          </div>
        </div>
      </fieldset>

      {candidats.length > 0 ? (
        <div className="space-y-2 rounded-md border border-statut-attention/40 bg-statut-attention/12 p-3">
          <p className="texte-libelle font-semibold text-foreground">
            {t('clients:doublons.titre')}
          </p>
          <ul className="space-y-2">
            {candidats.map((candidat) => (
              <li
                key={candidat.clientId}
                className="flex items-center justify-between gap-3 texte-corps"
              >
                <span className="min-w-0 truncate">
                  {candidat.nom} · {t(`clients:doublons.criteres.${candidat.critere}`)} ·{' '}
                  {t('clients:doublons.score')} {Math.round(candidat.score * 100)} %
                </span>
                <Link
                  to={chemins.clients.detail(candidat.clientId, site)}
                  className="shrink-0 texte-libelle font-medium text-primary underline"
                >
                  {t('clients:doublons.voir')}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Button type="submit" className="w-full" disabled={enCours}>
        {enCours ? t('commun:chargement.enCours') : t('clients:actions.creer')}
      </Button>

      <AvertissementConfirmable
        ouvert={entreeEnAttente !== null}
        onOuvertChange={(ouvert) => {
          if (!ouvert) setEntreeEnAttente(null);
        }}
        titre={t('clients:doublons.titre')}
        description={
          premierCandidat
            ? `${t('clients:doublons.clientSimiliaire')} — ${premierCandidat.nom} (${premierCandidat.numeroClient}).`
            : t('clients:doublons.clientSimiliaire')
        }
        libelleConfirmation={t('clients:doublons.creerQuandMeme')}
        onConfirmer={confirmerMalgreDoublon}
        enCours={enCours}
      />
    </form>
  );
}
