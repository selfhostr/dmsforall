import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';

import { schemaCreationClient, type EntreeCreationClient, type TypeClient } from '@dfa/shared';

import { ErreurReseau, messageErreur } from '@/api/erreurs';
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
  readonly onCree: (clientId: string) => void;
}

/** Transforme une saisie vide en `undefined` — nécessaire pour tout champ
 *  `schemaTexteCourt.nullish()` (`@dfa/shared`) : `nullish()` accepte `null`/`undefined`, jamais
 *  une chaîne vide (qui échoue `min(1)`). Sans ce garde-fou, un champ facultatif laissé vide
 *  produirait une erreur de validation plutôt que d'être simplement omis. */
function videVersIndefini(valeur: string): string | undefined {
  return valeur === '' ? undefined : valeur;
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
export function FormulaireNouveauClient({ onCree }: Props) {
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

  const form = useForm({
    resolver: zodResolver(schemaCreationClient),
    defaultValues: {
      type: 'particulier',
      langueCorrespondance: langueCourante,
      adressePrincipale: { rue: '', npa: '', localite: '', pays: 'CH' },
      telephones: [],
      poObligatoire: false,
    },
  });

  const type = form.watch('type');
  const nom = form.watch('nom');
  const raisonSociale = form.watch('raisonSociale');
  const npa = form.watch('adressePrincipale.npa');
  const email = form.watch('email');
  const ide = form.watch('ide');

  const [criteres, setCriteres] = useState<{
    nom?: string;
    npa?: string;
    email?: string;
    telephoneMobile?: string;
    ide?: string;
  }>({});

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
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="nc-nom">{t('clients:identite.nom')}</Label>
            <Input
              id="nc-nom"
              readOnly={enCours}
              aria-invalid={form.formState.errors.nom ? true : undefined}
              {...form.register('nom', { setValueAs: videVersIndefini })}
            />
            {form.formState.errors.nom ? (
              <p className="text-sm text-destructive">{t('validation:requis')}</p>
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
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="nc-raison-sociale">{t('clients:identite.raisonSociale')}</Label>
            <Input
              id="nc-raison-sociale"
              readOnly={enCours}
              aria-invalid={form.formState.errors.raisonSociale ? true : undefined}
              {...form.register('raisonSociale', { setValueAs: videVersIndefini })}
            />
            {form.formState.errors.raisonSociale ? (
              <p className="text-sm text-destructive">{t('validation:requis')}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="nc-ide">{t('clients:identite.ide')}</Label>
            <Input
              id="nc-ide"
              readOnly={enCours}
              placeholder="CHE-123.456.789"
              {...form.register('ide', { setValueAs: videVersIndefini })}
            />
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
            {...form.register('email', { setValueAs: videVersIndefini })}
          />
          {form.formState.errors.email ? (
            <p className="text-sm text-destructive">{t('validation:email.invalide')}</p>
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
            {...form.register('adressePrincipale.rue')}
          />
          {form.formState.errors.adressePrincipale?.rue ? (
            <p className="text-sm text-destructive">{t('validation:requis')}</p>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="nc-npa">{t('clients:adresses.champs.npa')}</Label>
            <Input
              id="nc-npa"
              readOnly={enCours}
              aria-invalid={form.formState.errors.adressePrincipale?.npa ? true : undefined}
              {...form.register('adressePrincipale.npa')}
            />
            {form.formState.errors.adressePrincipale?.npa ? (
              <p className="text-sm text-destructive">{t('validation:requis')}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="nc-localite">{t('clients:adresses.champs.localite')}</Label>
            <Input
              id="nc-localite"
              readOnly={enCours}
              aria-invalid={form.formState.errors.adressePrincipale?.localite ? true : undefined}
              {...form.register('adressePrincipale.localite')}
            />
            {form.formState.errors.adressePrincipale?.localite ? (
              <p className="text-sm text-destructive">{t('validation:requis')}</p>
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
