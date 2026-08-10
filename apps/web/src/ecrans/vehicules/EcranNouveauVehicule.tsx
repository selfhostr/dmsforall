import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, WifiOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Controller, useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { schemaCreationVehicule } from '@dfa/shared';

import { ErreurReseau, messageErreur } from '@/api/erreurs';
import { useCleIdempotence } from '@/api/idempotence';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DateInput } from '@/components/ui/date-input';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useClient } from '@/hooks/clients/useClient';
import { useCreerVehicule } from '@/hooks/vehicules/useCreerVehicule';
import { chemins } from '@/routes/chemins';

/** Transforme une saisie vide en `undefined` — nécessaire pour tout champ `.nullish()` de
 *  `schemaCreationVehicule` (`@dfa/shared`) : `nullish()` accepte `null`/`undefined`, jamais une
 *  chaîne vide (qui échoue `min(1)`/`length(n)`). Même garde-fou, même raison que
 *  `videVersIndefini` dans `ecrans/clients/FormulaireNouveauClient.tsx` — dupliqué ici plutôt
 *  qu'importé : deux domaines distincts (clients/véhicules), pas de dépendance croisée entre eux. */
function videVersIndefini(valeur: string): string | undefined {
  return valeur === '' ? undefined : valeur;
}

/**
 * Création d'un véhicule (`POST /vehicules`, RM-15 → RM-19) — écran dédié (pas de sheet, à la
 * différence de `FormulaireNouveauClient`) : cet écran est atteint par navigation DEPUIS un autre
 * module (Ventes VN/VO, `SelecteurVehiculeExistant`), une route à part entière est donc le seul
 * point d'entrée cohérent, contrairement à la fiche client qui ne se crée jamais qu'à l'intérieur
 * de son propre écran de liste.
 *
 * Comme pour la création client, seule l'identité minimale (marque, modèle, et les identifiants
 * qui évitent un doublon — VIN, plaque) est demandée ici. Le reste (données d'atelier, garanties,
 * importation détaillée…) se saisit après création, depuis la fiche (`EcranFicheVehicule`), jamais
 * dans ce formulaire de première saisie.
 *
 * `?clientId=` (geste manquant signalé par @laupernoe : « je ne sais pas comment assigner un véhicule à
 * un client ») — posé par `EcranFicheClient` (« Ajouter un véhicule », `cheminNouveauVehicule`,
 * hors périmètre d'écriture ici : chemin construit localement, `chemins.vehicules.nouveau` ne
 * porte pas ce paramètre). Quand il est présent, le détenteur (`detenteurId`,
 * `schemaCreationVehicule`) est envoyé SANS champ de saisie — la fiche client d'où l'on vient EST
 * la sélection, redemander reviendrait à revalider ce que le garagiste a déjà établi en cliquant
 * depuis là. `POST /vehicules` crée déjà la détention d'origine atomiquement avec le véhicule
 * (`service-vehicule.ts`, ligne `if (entree.detenteurId)`) — aucun second appel n'est nécessaire.
 * Sans `?clientId=` (accès direct, Ventes VN/VO...), le détenteur reste absent à la création,
 * assignable ensuite depuis la fiche (`DialogueRattacherClient`, même écran que le changement de
 * détenteur — RM-20/21).
 *
 * Un VIN absent ou court (< 17 caractères) N'EST PAS refusé (RM-15) : les véhicules anciens et
 * certains imports n'ont pas de VIN normalisé, et bloquer la saisie enverrait le garagiste dans un
 * tableur. Le serveur renvoie l'avertissement `VEHICULE_VIN_COURT` dans une réponse `2xx`, jamais
 * un refus — la mutation (`useCreerVehicule`) réussit dans les deux cas.
 */
export function EcranNouveauVehicule() {
  const { t } = useTranslation(['vehicules', 'commun', 'validation', 'erreurs']);
  const navigate = useNavigate();
  const idempotence = useCleIdempotence();
  const creerVehicule = useCreerVehicule();
  // Le site sélectionné est un paramètre de requête, jamais un état global (routes/chemins.ts) :
  // conservé pour revenir à la même liste filtrée après annulation ou création.
  const [searchParams] = useSearchParams();
  const site = searchParams.get('site') ?? undefined;
  const clientId = searchParams.get('clientId') ?? undefined;
  const requeteClient = useClient(clientId);

  const form = useForm({
    resolver: zodResolver(schemaCreationVehicule),
    defaultValues: {
      marque: '',
      modele: '',
      importe: false,
    },
  });

  const importe = form.watch('importe');

  const soumettre = form.handleSubmit((entree) => {
    creerVehicule.mutate(
      { entree: { ...entree, detenteurId: clientId ?? null }, idempotencyKey: idempotence.cle },
      {
        onSuccess: (reponse) => {
          idempotence.regenerer();
          navigate(chemins.vehicules.detail(reponse.donnees.id, site));
        },
      },
    );
  });

  const enCours = creerVehicule.isPending;
  const erreur = creerVehicule.error;
  const estErreurReseau = erreur instanceof ErreurReseau;
  const cheminAnnuler = clientId
    ? chemins.clients.detail(clientId, site)
    : chemins.vehicules.liste(site);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 p-6">
      <h1 className="texte-titre font-semibold text-foreground">{t('vehicules:nouveau')}</h1>

      {clientId && requeteClient.data ? (
        <p className="texte-corps text-muted-foreground">
          {t('vehicules:nouveauPourClient', { nom: requeteClient.data.nomAffiche })}
        </p>
      ) : null}

      <form onSubmit={soumettre} noValidate className="flex flex-col gap-5">
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

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nv-marque">{t('vehicules:identite.marque')}</Label>
            <Input
              id="nv-marque"
              readOnly={enCours}
              aria-invalid={form.formState.errors.marque ? true : undefined}
              {...form.register('marque')}
            />
            {form.formState.errors.marque ? (
              <p className="text-sm text-destructive">{t('validation:requis')}</p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nv-modele">{t('vehicules:identite.modele')}</Label>
            <Input
              id="nv-modele"
              readOnly={enCours}
              aria-invalid={form.formState.errors.modele ? true : undefined}
              {...form.register('modele')}
            />
            {form.formState.errors.modele ? (
              <p className="text-sm text-destructive">{t('validation:requis')}</p>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nv-version">{t('vehicules:identite.version')}</Label>
            <Input
              id="nv-version"
              readOnly={enCours}
              {...form.register('version', { setValueAs: videVersIndefini })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nv-finition">{t('vehicules:identite.finition')}</Label>
            <Input
              id="nv-finition"
              readOnly={enCours}
              {...form.register('finition', { setValueAs: videVersIndefini })}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nv-vin">{t('vehicules:identite.vin')}</Label>
            <Input
              id="nv-vin"
              readOnly={enCours}
              aria-invalid={form.formState.errors.vin ? true : undefined}
              {...form.register('vin', { setValueAs: videVersIndefini })}
            />
            {form.formState.errors.vin ? (
              <p className="text-sm text-destructive">{t('validation:longueurMin', { min: 5 })}</p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nv-code-type">{t('vehicules:identite.codeType')}</Label>
            <Input
              id="nv-code-type"
              readOnly={enCours}
              {...form.register('codeTypeCh', { setValueAs: videVersIndefini })}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nv-plaque">{t('vehicules:identite.plaque')}</Label>
            <Input
              id="nv-plaque"
              readOnly={enCours}
              {...form.register('plaque', { setValueAs: videVersIndefini })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nv-canton">{t('vehicules:plaques.canton')}</Label>
            <Input
              id="nv-canton"
              readOnly={enCours}
              maxLength={2}
              aria-invalid={form.formState.errors.canton ? true : undefined}
              {...form.register('canton', { setValueAs: videVersIndefini })}
            />
            {form.formState.errors.canton ? (
              <p className="text-sm text-destructive">{t('validation:longueurMin', { min: 2 })}</p>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="nv-mise-circulation">{t('vehicules:identite.mise1reCirc')}</Label>
          <Controller
            control={form.control}
            name="premiereMiseEnCirculationLe"
            render={({ field }) => (
              <DateInput
                id="nv-mise-circulation"
                disabled={enCours}
                className="max-w-[200px]"
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />
        </div>

        <label className="flex h-11 items-center gap-2 texte-corps">
          <Checkbox
            checked={importe}
            disabled={enCours}
            onCheckedChange={(coche) => form.setValue('importe', coche === true)}
          />
          {t('vehicules:importation.importe')}
        </label>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={enCours}>
            {enCours ? t('commun:chargement.enCours') : t('vehicules:creer')}
          </Button>
          <Button type="button" variant="outline" disabled={enCours} asChild>
            <Link to={cheminAnnuler}>{t('commun:actions.annuler')}</Link>
          </Button>
        </div>
      </form>
    </div>
  );
}
