import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, WifiOff } from 'lucide-react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Controller, useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { schemaCreationVehicule, type DetailCollisionPlaqueVehicule } from '@dfa/shared';

import { ErreurApi, ErreurReseau, messageErreur } from '@/api/erreurs';
import { useCleIdempotence } from '@/api/idempotence';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DateInput } from '@/components/ui/date-input';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PanneauLateral } from '@/composants/PanneauLateral';
import {
  ChampAutocompletionVehicule,
  type OptionAutocompletionVehicule,
} from '@/composants/vehicules/ChampAutocompletionVehicule';
import { useClient } from '@/hooks/clients/useClient';
import { useValeurDebouncee } from '@/hooks/commun/useValeurDebouncee';
import { useCreerVehicule } from '@/hooks/vehicules/useCreerVehicule';
import { useMarquesVehicule } from '@/hooks/vehicules/useMarquesVehicule';
import { useModelesVehicule } from '@/hooks/vehicules/useModelesVehicule';
import { formaterDate } from '@/lib/formats';
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

  // Autocomplétion marque/modèle (référentiel véhicules suisse ASTRA/TAS, contrat gelé
  // `packages/shared/src/contrats/vehicules/referentiel-vehicules-ch.ts`) — repli manuel TOUJOURS
  // possible : `marque`/`modele` restent des champs texte libres au sens du formulaire
  // (`schemaCreationVehicule`), l'autocomplétion ne fait que suggérer.
  const marqueSaisie = form.watch('marque');
  const modeleSaisie = form.watch('modele');
  const [marqueTemporisee] = useValeurDebouncee(marqueSaisie);
  const [rechercheModeleTemporisee] = useValeurDebouncee(modeleSaisie);

  const marquesQuery = useMarquesVehicule(marqueTemporisee, {
    enabled: marqueTemporisee.trim() !== '',
  });
  const modelesQuery = useModelesVehicule(marqueTemporisee, rechercheModeleTemporisee, {
    enabled: marqueTemporisee.trim() !== '',
  });

  const optionsMarques: readonly OptionAutocompletionVehicule[] = (
    marquesQuery.data?.marques ?? []
  ).map((marque) => ({
    valeur: marque.nom,
    complement: t('vehicules:identite.autocompletion.nombreModeles', {
      count: marque.nombreModeles,
    }),
  }));
  const optionsModeles: readonly OptionAutocompletionVehicule[] = (
    modelesQuery.data?.modeles ?? []
  ).map((modele) => ({ valeur: modele.nom, complement: modele.codeTypeCh }));

  const erreurMarques = marquesQuery.isError
    ? t('vehicules:identite.autocompletion.erreurRecherche')
    : null;
  const erreurModeles = modelesQuery.isError
    ? t('vehicules:identite.autocompletion.erreurRecherche')
    : null;

  // Choisir une marque conditionne les modèles suggérés ; changer VRAIMENT de marque réinitialise
  // le modèle déjà saisi — mais UNIQUEMENT sur un choix explicite dans la liste (`onSelectOption`),
  // jamais à chaque frappe : un garagiste qui corrige une faute de frappe dans la marque ne doit
  // jamais se faire effacer le modèle qu'il vient de saisir (besoin explicite de @laupernoe).
  const derniereMarqueConfirmeeRef = useRef('');

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

  // 409 VEHICULE_PLAQUE_COLLISION (RM-18, CT-06, issue #96) : même traitement que
  // `DialogueModifierIdentiteVehicule.tsx` — nommer le véhicule fautif SOUS le champ plaque,
  // jamais dans le bandeau générique. `blocages[0].id` vaut `'plaque'` ICI (nom du champ dans
  // `EntreeCreationVehicule`) contre `'valeur'` sur `POST /vehicules/{id}/plaques` — convention du
  // dépôt documentée dans `DetailCollisionPlaqueVehicule` (`@dfa/shared`) : ne jamais brancher sur
  // `.id`, seulement sur le `code` puis lire `.donnees`.
  const erreurEstCollisionPlaque =
    erreur instanceof ErreurApi && erreur.probleme.code === 'VEHICULE_PLAQUE_COLLISION';
  // Absent dans le cas de course où la ligne fautive n'est plus retrouvable à la relecture
  // serveur (voir l'en-tête de `DetailCollisionPlaqueVehicule`) — message sobre en repli, jamais
  // un libellé à trous.
  const detailCollisionPlaque: DetailCollisionPlaqueVehicule | undefined =
    erreur instanceof ErreurApi && erreurEstCollisionPlaque
      ? (erreur.blocages[0]?.donnees as DetailCollisionPlaqueVehicule | undefined)
      : undefined;
  const erreurBandeau = erreurEstCollisionPlaque ? undefined : erreur;
  const estErreurReseau = erreurBandeau instanceof ErreurReseau;
  const cheminAnnuler = clientId
    ? chemins.clients.detail(clientId, site)
    : chemins.vehicules.liste(site);

  // Saisie dans le panneau latéral droit (même geste que « Nouveau client »), par-dessus la liste.
  return (
    <PanneauLateral
      ouvert
      onOuvertChange={(ouvert) => {
        if (!ouvert) navigate(cheminAnnuler);
      }}
      titre={t('vehicules:nouveau')}
      description={
        clientId && requeteClient.data
          ? t('vehicules:nouveauPourClient', { nom: requeteClient.data.nomAffiche })
          : undefined
      }
      pied={
        <>
          <Button type="button" variant="outline" disabled={enCours} asChild>
            <Link to={cheminAnnuler}>{t('commun:actions.annuler')}</Link>
          </Button>
          <Button type="submit" form="nv-formulaire" disabled={enCours}>
            {enCours ? t('commun:chargement.enCours') : t('vehicules:creer')}
          </Button>
        </>
      }
    >
      <div className="flex w-full flex-col gap-5">
        <form id="nv-formulaire" onSubmit={soumettre} noValidate className="flex flex-col gap-5">
          {erreurBandeau ? (
            <Alert variant={estErreurReseau ? 'avertissement' : 'destructive'}>
              {estErreurReseau ? (
                <WifiOff className="h-4 w-4" aria-hidden="true" />
              ) : (
                <AlertCircle className="h-4 w-4" aria-hidden="true" />
              )}
              <AlertTitle>
                {t(estErreurReseau ? 'erreurs:reseau.titre' : 'erreurs:inattendue.titre')}
              </AlertTitle>
              <AlertDescription>{messageErreur(erreurBandeau, t)}</AlertDescription>
            </Alert>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nv-marque">{t('vehicules:identite.marque')}</Label>
              <Controller
                control={form.control}
                name="marque"
                render={({ field }) => (
                  <ChampAutocompletionVehicule
                    id="nv-marque"
                    libelle={t('vehicules:identite.marque')}
                    valeur={field.value}
                    onValeurChange={field.onChange}
                    options={optionsMarques}
                    enChargement={marquesQuery.isFetching}
                    erreur={erreurMarques}
                    placeholder={t('vehicules:identite.autocompletion.placeholderMarque')}
                    disabled={enCours}
                    ariaInvalid={form.formState.errors.marque ? true : undefined}
                    onSelectionOption={(option) => {
                      if (option.valeur !== derniereMarqueConfirmeeRef.current) {
                        form.setValue('modele', '');
                      }
                      derniereMarqueConfirmeeRef.current = option.valeur;
                    }}
                  />
                )}
              />
              {form.formState.errors.marque ? (
                <p className="texte-corps text-destructive">{t('validation:requis')}</p>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nv-modele">{t('vehicules:identite.modele')}</Label>
              <Controller
                control={form.control}
                name="modele"
                render={({ field }) => (
                  <ChampAutocompletionVehicule
                    id="nv-modele"
                    libelle={t('vehicules:identite.modele')}
                    valeur={field.value}
                    onValeurChange={field.onChange}
                    options={optionsModeles}
                    enChargement={modelesQuery.isFetching}
                    erreur={erreurModeles}
                    placeholder={t('vehicules:identite.autocompletion.placeholderModele')}
                    disabled={enCours}
                    ariaInvalid={form.formState.errors.modele ? true : undefined}
                  />
                )}
              />
              {form.formState.errors.modele ? (
                <p className="texte-corps text-destructive">{t('validation:requis')}</p>
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
                <p className="texte-corps text-destructive">
                  {t('validation:longueurMin', { min: 5 })}
                </p>
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
                placeholder={t('vehicules:identite.plaqueExemple')}
                aria-invalid={erreurEstCollisionPlaque ? true : undefined}
                aria-describedby={
                  erreurEstCollisionPlaque ? 'nv-plaque-collision-erreur' : undefined
                }
                {...form.register('plaque', { setValueAs: videVersIndefini })}
              />
              <p className="texte-libelle text-muted-foreground">
                {t('vehicules:identite.plaqueAide')}
              </p>
              {/* 409 VEHICULE_PLAQUE_COLLISION (issue #96) — même rendu que
               *  `DialogueModifierIdentiteVehicule.tsx` : le véhicule fautif est NOMMÉ quand le
               *  serveur a pu le relire, sinon message sobre (course rare où la ligne fautive n'est
               *  plus retrouvable à la relecture), jamais un libellé à trous. */}
              {erreurEstCollisionPlaque ? (
                <Alert id="nv-plaque-collision-erreur" variant="destructive" className="p-3">
                  <AlertDescription>
                    {detailCollisionPlaque ? (
                      <>
                        {t('vehicules:collisionPlaque.avecDetail', {
                          plaque: detailCollisionPlaque.plaque,
                          vehicule: `${detailCollisionPlaque.marque} ${detailCollisionPlaque.modele}${
                            detailCollisionPlaque.version ? ` ${detailCollisionPlaque.version}` : ''
                          }`,
                          debutLe: formaterDate(detailCollisionPlaque.debutLe),
                        })}{' '}
                        <Link
                          to={chemins.vehicules.detail(detailCollisionPlaque.vehiculeId)}
                          className="underline"
                        >
                          {t('vehicules:collisionPlaque.voirVehicule')}
                        </Link>
                      </>
                    ) : (
                      t('vehicules:collisionPlaque.sansDetail')
                    )}
                  </AlertDescription>
                </Alert>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nv-canton">{t('vehicules:plaques.canton')}</Label>
              <Input
                id="nv-canton"
                readOnly={enCours}
                maxLength={2}
                placeholder={t('vehicules:plaques.cantonExemple')}
                aria-invalid={form.formState.errors.canton ? true : undefined}
                {...form.register('canton', { setValueAs: videVersIndefini })}
              />
              {form.formState.errors.canton ? (
                <p className="texte-corps text-destructive">
                  {t('validation:longueurMin', { min: 2 })}
                </p>
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
        </form>
      </div>
    </PanneauLateral>
  );
}
