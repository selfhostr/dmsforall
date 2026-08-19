import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, WifiOff } from 'lucide-react';
import { useState } from 'react';
import {
  useForm,
  Controller,
  type DefaultValues,
  type FieldPath,
  type Resolver,
} from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { z } from 'zod';

import type { Avertissement, DetailCollisionPlaqueVehicule, Langue } from '@dfa/shared';

import { ErreurApi, ErreurReseau, messageErreur, messageErreurChamp } from '@/api/erreurs';
import { useCleIdempotence } from '@/api/idempotence';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { DateInput } from '@/components/ui/date-input';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCreerClient } from '@/hooks/clients/useCreerClient';
import { useCreerVehicule } from '@/hooks/vehicules/useCreerVehicule';
import { useLangue } from '@/hooks/useLangue';
import { formaterDate } from '@/lib/formats';
import { cn } from '@/lib/utils';
import { chemins } from '@/routes/chemins';

import { ChampConfiance, type EtatConfianceChamp } from './ChampConfiance';
import type {
  CorrespondanceClientExistant,
  DonneesPermisScanne,
  NiveauConfianceOcr,
} from './contrat-ocr.temporaire';
import { schemaFormulaireScan, type ValeursFormulaireScan } from './schema-formulaire-scan';

type ValeursSaisieFormulaireScan = z.input<typeof schemaFormulaireScan>;

export interface ResultatCreationScan {
  readonly client: { readonly id: string; readonly nomAffiche: string; readonly cree: boolean };
  readonly vehicule: { readonly id: string; readonly libelle: string; readonly cree: boolean };
  readonly avertissementsClient: readonly Avertissement[];
}

interface Props {
  readonly donnees: DonneesPermisScanne;
  /** Présent = un client existant a déjà été identifié par l'OCR (`correspondances.client`) : le
   *  bloc détenteur n'est PAS rendu, `POST /clients` n'est jamais appelé, le véhicule créé est
   *  rattaché directement à cet id. Absent = les deux ressources sont à créer. */
  readonly clientExistant?: CorrespondanceClientExistant;
  readonly onSucces: (resultat: ResultatCreationScan) => void;
  readonly onAnnuler: () => void;
}

function texte(champ: { readonly valeur: string | null }): string {
  return champ.valeur ?? '';
}

function videVersIndefini(valeur: string): string | undefined {
  return valeur === '' ? undefined : valeur;
}

const CHAMPS_CLIENT_NULLISH = ['nom', 'prenom', 'raisonSociale', 'ide'] as const;
const CHAMPS_VEHICULE_NULLISH = [
  'vin',
  'plaque',
  'canton',
  'version',
  'finition',
  'codeTypeCh',
] as const;

function adresseEstVide(
  adresse: ValeursSaisieFormulaireScan['client']['adressePrincipale'],
): boolean {
  if (!adresse) return true;
  return !adresse.rue?.trim() && !adresse.npa?.trim() && !adresse.localite?.trim();
}

/**
 * Même patron que `resolverClient` (`ecrans/clients/FormulaireNouveauClient.tsx`) : normalise
 * `''` -> `undefined` sur les champs `.nullish()` texte (un champ non lu par l'OCR est posé à
 * `''`, jamais `undefined`, pour que `form.reset` vide bien le nœud DOM — voir la doc de tête de
 * `FormulaireNouveauClient`), et efface le bloc adresse s'il est resté entièrement vide (RF-59 :
 * un client comptoir sans rendez-vous n'a souvent qu'un nom à donner).
 */
const resolverFormulaireScan: Resolver<
  ValeursSaisieFormulaireScan,
  unknown,
  ValeursFormulaireScan
> = (valeurs, contexte, options) => {
  const client = { ...valeurs.client };
  for (const champ of CHAMPS_CLIENT_NULLISH) {
    if (client[champ] === '') client[champ] = undefined;
  }
  const clientNormalise = adresseEstVide(client.adressePrincipale)
    ? { ...client, adressePrincipale: undefined }
    : client;

  const vehicule = { ...valeurs.vehicule };
  for (const champ of CHAMPS_VEHICULE_NULLISH) {
    if (vehicule[champ] === '') vehicule[champ] = undefined;
  }

  return zodResolver(schemaFormulaireScan)(
    { client: clientNormalise, vehicule },
    contexte,
    options,
  );
};

/**
 * Valeurs par défaut. Quand `clientExistant` est fourni, `client` reçoit des valeurs FACTICES
 * mais valides (`type: 'particulier'`, `nom: 'x'`) — jamais rendues, jamais envoyées (voir le
 * commentaire de tête de `schema-formulaire-scan.ts`) : la forme du formulaire reste UNIQUE
 * (un seul `useForm`, un seul schéma) quel que soit le cas, ce qui évite un second schéma/second
 * hook conditionnel — React interdit d'appeler des hooks différents selon une condition, et le
 * coût d'un champ jamais rendu dont la valeur ne quitte jamais ce composant est nul.
 */
function valeursParDefaut(
  donnees: DonneesPermisScanne,
  clientExistant: CorrespondanceClientExistant | undefined,
  langueCourante: Langue,
): DefaultValues<ValeursSaisieFormulaireScan> {
  const estEntreprise = donnees.detenteur.estEntreprise.valeur === true;
  return {
    client: clientExistant
      ? { type: 'particulier', nom: 'x', langueCorrespondance: langueCourante }
      : {
          type: estEntreprise ? 'entreprise' : 'particulier',
          nom: texte(donnees.detenteur.nom),
          prenom: texte(donnees.detenteur.prenom),
          raisonSociale: texte(donnees.detenteur.raisonSociale),
          langueCorrespondance: langueCourante,
          adressePrincipale: {
            rue: texte(donnees.detenteur.rue),
            npa: texte(donnees.detenteur.npa),
            localite: texte(donnees.detenteur.localite),
            pays: 'CH',
          },
        },
    vehicule: {
      marque: texte(donnees.vehicule.marque),
      modele: texte(donnees.vehicule.modele),
      vin: texte(donnees.vehicule.vin),
      plaque: texte(donnees.vehicule.plaque),
      canton: texte(donnees.vehicule.canton),
      premiereMiseEnCirculationLe: donnees.vehicule.premiereMiseEnCirculationLe.valeur ?? undefined,
      importe: false,
    },
  };
}

/** « Validé » dès que l'utilisateur a touché le champ (`dirtyFields`, comparé aux valeurs par
 *  défaut par react-hook-form) — relire une valeur douteuse ET la laisser telle quelle EST la
 *  confirmer, retaper n'est pas la condition. Sinon, reflète directement la confiance serveur. */
function etatConfiance(
  confiance: NiveauConfianceOcr,
  modifie: boolean | undefined,
): EtatConfianceChamp {
  if (modifie) return 'valide';
  if (confiance === 'sure') return 'valide';
  if (confiance === 'douteuse') return 'douteux';
  return 'nonLu';
}

export function FormulairePermisScanne({ donnees, clientExistant, onSucces, onAnnuler }: Props) {
  const { t } = useTranslation(['scan', 'clients', 'vehicules', 'commun', 'validation', 'erreurs']);
  const { langue: langueCourante, languesDisponibles } = useLangue();

  const creerClient = useCreerClient();
  const creerVehicule = useCreerVehicule();
  const idempotenceClient = useCleIdempotence();
  const idempotenceVehicule = useCleIdempotence();

  // Une fois le détenteur CONFIRMÉ (client existant fourni dès le départ, ou création réussie),
  // son id est mémorisé ici pour toute la durée de vie du composant — un ré-essai après échec de
  // la création du véhicule (panne réseau, collision de plaque) ne recrée alors JAMAIS le client :
  // seule la création du véhicule est retentée, avec ce même id. C'est ce qui rend la panne
  // partielle rattrapable sans double-création (« jamais de faux succès », et jamais de doublon
  // silencieux non plus).
  const [detenteurConfirme, setDetenteurConfirme] = useState<{
    readonly id: string;
    readonly nomAffiche: string;
    readonly cree: boolean;
  } | null>(
    clientExistant
      ? { id: clientExistant.id, nomAffiche: clientExistant.nomAffiche, cree: false }
      : null,
  );
  const [avertissementsClient, setAvertissementsClient] = useState<readonly Avertissement[]>([]);

  const form = useForm<ValeursSaisieFormulaireScan, unknown, ValeursFormulaireScan>({
    resolver: resolverFormulaireScan,
    defaultValues: valeursParDefaut(donnees, clientExistant, langueCourante),
  });

  const type = form.watch('client.type');
  const dirty = form.formState.dirtyFields;

  // `detenteur`/`avertissements` reçus en PARAMÈTRES, jamais relus depuis l'état React à
  // l'intérieur de ce callback : `setDetenteurConfirme`/`setAvertissementsClient` sont
  // asynchrones (React ne les applique qu'au rendu suivant), et cette fonction est parfois
  // appelée SYNCHRONEMENT juste après les avoir posés (chemin « client tout juste créé »,
  // ci-dessous) — lire `detenteurConfirme`/`avertissementsClient` ici y verrait encore leur
  // valeur du rendu PRÉCÉDENT (fermeture obsolète), pas celle qu'on vient de poser. Défaut
  // silencieux qui aurait renvoyé un nom de client vide/des avertissements manquants à `onSucces`
  // sans jamais lever d'erreur — exactement le genre de défaut que ce dépôt demande de mesurer
  // plutôt que de supposer.
  function lancerCreationVehicule(
    detenteur: { readonly id: string; readonly nomAffiche: string; readonly cree: boolean },
    entreeVehicule: ValeursFormulaireScan['vehicule'],
    avertissements: readonly Avertissement[],
  ) {
    creerVehicule.mutate(
      {
        entree: { ...entreeVehicule, detenteurId: detenteur.id },
        idempotencyKey: idempotenceVehicule.cle,
      },
      {
        onSuccess: (reponse) => {
          idempotenceVehicule.regenerer();
          onSucces({
            client: detenteur,
            vehicule: { id: reponse.donnees.id, libelle: reponse.donnees.designation, cree: true },
            avertissementsClient: avertissements,
          });
        },
        onError: (erreurMutation) => {
          if (erreurMutation instanceof ErreurApi) {
            for (const champErreur of erreurMutation.erreursChamp) {
              form.setError(
                `vehicule.${champErreur.champ}` as FieldPath<ValeursSaisieFormulaireScan>,
                {
                  type: 'server',
                  message: messageErreurChamp(champErreur, t),
                },
              );
            }
          }
        },
      },
    );
  }

  const soumettre = form.handleSubmit((valeurs) => {
    if (detenteurConfirme) {
      lancerCreationVehicule(detenteurConfirme, valeurs.vehicule, avertissementsClient);
      return;
    }
    creerClient.mutate(
      { entree: valeurs.client, idempotencyKey: idempotenceClient.cle },
      {
        onSuccess: (reponse) => {
          idempotenceClient.regenerer();
          const detenteur = {
            id: reponse.donnees.id,
            nomAffiche: reponse.donnees.nomAffiche,
            cree: true,
          };
          setAvertissementsClient(reponse.avertissements);
          setDetenteurConfirme(detenteur);
          lancerCreationVehicule(detenteur, valeurs.vehicule, reponse.avertissements);
        },
        onError: (erreurMutation) => {
          if (erreurMutation instanceof ErreurApi) {
            for (const champErreur of erreurMutation.erreursChamp) {
              form.setError(
                `client.${champErreur.champ}` as FieldPath<ValeursSaisieFormulaireScan>,
                {
                  type: 'server',
                  message: messageErreurChamp(champErreur, t),
                },
              );
            }
          }
        },
      },
    );
  });

  const enCours = creerClient.isPending || creerVehicule.isPending;
  // `creerClient.error` retombe à `null` dès que la mutation réussit (comportement TanStack
  // Query) : une fois le détenteur confirmé, seule une erreur de `creerVehicule` peut donc
  // subsister ici — pas de branchement explicite sur `detenteurConfirme` nécessaire.
  const erreur = creerClient.error ?? creerVehicule.error;
  const estErreurReseau = erreur instanceof ErreurReseau;

  // 409 VEHICULE_PLAQUE_COLLISION — même traitement qu'`EcranNouveauVehicule.tsx` : nommer le
  // véhicule fautif SOUS le champ plaque plutôt que de laisser un bandeau générique sans suite.
  // Race possible même quand `correspondances.vehicule` de l'OCR était absent (rien garanti côté
  // contrat temporaire, voir `contrat-ocr.temporaire.ts`) — ce chemin protège donc le produit
  // indépendamment de ce que l'OCR aura ou non implémenté.
  const erreurVehicule = creerVehicule.error;
  const erreurEstCollisionPlaque =
    erreurVehicule instanceof ErreurApi &&
    erreurVehicule.probleme.code === 'VEHICULE_PLAQUE_COLLISION';
  const detailCollisionPlaque: DetailCollisionPlaqueVehicule | undefined =
    erreurVehicule instanceof ErreurApi && erreurEstCollisionPlaque
      ? (erreurVehicule.blocages[0]?.donnees as DetailCollisionPlaqueVehicule | undefined)
      : undefined;

  return (
    <form onSubmit={soumettre} noValidate className="flex flex-col gap-6">
      {detenteurConfirme && !clientExistant ? (
        <Alert>
          <AlertTitle>{t('scan:formulaire.clientCreeTitre')}</AlertTitle>
          <AlertDescription>
            {t('scan:formulaire.clientCreeDescription', { nom: detenteurConfirme.nomAffiche })}
          </AlertDescription>
        </Alert>
      ) : null}

      {avertissementsClient.map((avertissement) => (
        <Alert key={avertissement.code} variant="avertissement">
          <AlertTitle>{t(`erreurs:codes.${avertissement.code}`)}</AlertTitle>
        </Alert>
      ))}

      {erreur && !erreurEstCollisionPlaque ? (
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

      {clientExistant ? (
        <div className="rounded-md border bg-muted/40 p-3">
          <p className="texte-libelle text-muted-foreground">{t('scan:formulaire.clientTrouve')}</p>
          <p className="texte-corps font-medium">{clientExistant.nomAffiche}</p>
        </div>
      ) : (
        <fieldset className="flex flex-col gap-4 rounded-md border p-3">
          <legend className="px-1 texte-libelle font-medium text-foreground">
            {t('scan:formulaire.sectionDetenteur')}
          </legend>

          <div className="flex flex-col gap-1.5">
            <Label>{t('clients:liste.filtres.type')}</Label>
            <div role="group" className="inline-flex overflow-hidden rounded-md border">
              {(['particulier', 'entreprise'] as const).map((valeur) => (
                <button
                  key={valeur}
                  type="button"
                  aria-pressed={type === valeur}
                  onClick={() =>
                    form.setValue('client.type', valeur, {
                      shouldValidate: true,
                      shouldDirty: true,
                    })
                  }
                  className={cn(
                    'h-11 px-4 texte-corps font-medium transition-colors',
                    type === valeur
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-background text-foreground hover:bg-muted',
                  )}
                >
                  {t(`clients:liste.types.${valeur}`)}
                </button>
              ))}
            </div>
          </div>

          {type === 'entreprise' ? (
            <ChampConfiance
              id="scan-raison-sociale"
              label={t('clients:identite.raisonSociale')}
              etat={etatConfiance(
                donnees.detenteur.raisonSociale.confiance,
                dirty.client?.raisonSociale,
              )}
              erreur={
                form.formState.errors.client?.raisonSociale ? t('validation:requis') : undefined
              }
            >
              <Input
                id="scan-raison-sociale"
                readOnly={enCours}
                aria-invalid={form.formState.errors.client?.raisonSociale ? true : undefined}
                {...form.register('client.raisonSociale', { setValueAs: videVersIndefini })}
              />
            </ChampConfiance>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <ChampConfiance
                id="scan-nom"
                label={t('clients:identite.nom')}
                etat={etatConfiance(donnees.detenteur.nom.confiance, dirty.client?.nom)}
                erreur={form.formState.errors.client?.nom ? t('validation:requis') : undefined}
              >
                <Input
                  id="scan-nom"
                  readOnly={enCours}
                  aria-invalid={form.formState.errors.client?.nom ? true : undefined}
                  {...form.register('client.nom', { setValueAs: videVersIndefini })}
                />
              </ChampConfiance>
              <ChampConfiance
                id="scan-prenom"
                label={t('clients:identite.prenom')}
                etat={etatConfiance(donnees.detenteur.prenom.confiance, dirty.client?.prenom)}
              >
                <Input
                  id="scan-prenom"
                  readOnly={enCours}
                  {...form.register('client.prenom', { setValueAs: videVersIndefini })}
                />
              </ChampConfiance>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="scan-langue">{t('clients:identite.langue')}</Label>
            <Select
              value={form.watch('client.langueCorrespondance')}
              onValueChange={(valeur) =>
                form.setValue('client.langueCorrespondance', valeur as Langue, {
                  shouldDirty: true,
                })
              }
            >
              <SelectTrigger id="scan-langue" aria-label={t('clients:identite.langue')}>
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
            <p className="texte-libelle text-muted-foreground">{t('scan:formulaire.langueAide')}</p>
          </div>

          <div className="grid grid-cols-[2fr_1fr_1fr] gap-3">
            <ChampConfiance
              id="scan-rue"
              label={t('clients:adresses.champs.rue')}
              etat={etatConfiance(
                donnees.detenteur.rue.confiance,
                dirty.client?.adressePrincipale?.rue,
              )}
            >
              <Input
                id="scan-rue"
                readOnly={enCours}
                {...form.register('client.adressePrincipale.rue')}
              />
            </ChampConfiance>
            <ChampConfiance
              id="scan-npa"
              label={t('clients:adresses.champs.npa')}
              etat={etatConfiance(
                donnees.detenteur.npa.confiance,
                dirty.client?.adressePrincipale?.npa,
              )}
            >
              <Input
                id="scan-npa"
                readOnly={enCours}
                {...form.register('client.adressePrincipale.npa')}
              />
            </ChampConfiance>
            <ChampConfiance
              id="scan-localite"
              label={t('clients:adresses.champs.localite')}
              etat={etatConfiance(
                donnees.detenteur.localite.confiance,
                dirty.client?.adressePrincipale?.localite,
              )}
            >
              <Input
                id="scan-localite"
                readOnly={enCours}
                {...form.register('client.adressePrincipale.localite')}
              />
            </ChampConfiance>
          </div>
        </fieldset>
      )}

      <fieldset className="flex flex-col gap-4 rounded-md border p-3">
        <legend className="px-1 texte-libelle font-medium text-foreground">
          {t('scan:formulaire.sectionVehicule')}
        </legend>

        <div className="grid grid-cols-2 gap-3">
          <ChampConfiance
            id="scan-marque"
            label={t('vehicules:identite.marque')}
            etat={etatConfiance(donnees.vehicule.marque.confiance, dirty.vehicule?.marque)}
            erreur={form.formState.errors.vehicule?.marque ? t('validation:requis') : undefined}
          >
            <Input
              id="scan-marque"
              readOnly={enCours}
              aria-invalid={form.formState.errors.vehicule?.marque ? true : undefined}
              {...form.register('vehicule.marque')}
            />
          </ChampConfiance>
          <ChampConfiance
            id="scan-modele"
            label={t('vehicules:identite.modele')}
            etat={etatConfiance(donnees.vehicule.modele.confiance, dirty.vehicule?.modele)}
            erreur={form.formState.errors.vehicule?.modele ? t('validation:requis') : undefined}
          >
            <Input
              id="scan-modele"
              readOnly={enCours}
              aria-invalid={form.formState.errors.vehicule?.modele ? true : undefined}
              {...form.register('vehicule.modele')}
            />
          </ChampConfiance>
        </div>

        <ChampConfiance
          id="scan-vin"
          label={t('vehicules:identite.vin')}
          etat={etatConfiance(donnees.vehicule.vin.confiance, dirty.vehicule?.vin)}
        >
          <Input
            id="scan-vin"
            readOnly={enCours}
            {...form.register('vehicule.vin', { setValueAs: videVersIndefini })}
          />
        </ChampConfiance>

        <div className="grid grid-cols-2 gap-3">
          <ChampConfiance
            id="scan-plaque"
            label={t('vehicules:identite.plaque')}
            etat={etatConfiance(donnees.vehicule.plaque.confiance, dirty.vehicule?.plaque)}
            erreur={
              erreurEstCollisionPlaque ? (
                <>
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
                </>
              ) : undefined
            }
          >
            <Input
              id="scan-plaque"
              readOnly={enCours}
              aria-invalid={erreurEstCollisionPlaque ? true : undefined}
              {...form.register('vehicule.plaque', { setValueAs: videVersIndefini })}
            />
          </ChampConfiance>
          <ChampConfiance
            id="scan-canton"
            label={t('vehicules:plaques.canton')}
            etat={etatConfiance(donnees.vehicule.canton.confiance, dirty.vehicule?.canton)}
          >
            <Input
              id="scan-canton"
              readOnly={enCours}
              maxLength={2}
              {...form.register('vehicule.canton', { setValueAs: videVersIndefini })}
            />
          </ChampConfiance>
        </div>

        <ChampConfiance
          id="scan-mise-circulation"
          label={t('vehicules:identite.mise1reCirc')}
          etat={etatConfiance(
            donnees.vehicule.premiereMiseEnCirculationLe.confiance,
            dirty.vehicule?.premiereMiseEnCirculationLe,
          )}
        >
          <Controller
            control={form.control}
            name="vehicule.premiereMiseEnCirculationLe"
            render={({ field }) => (
              <DateInput
                id="scan-mise-circulation"
                disabled={enCours}
                className="max-w-[200px]"
                value={field.value ?? undefined}
                onChange={field.onChange}
              />
            )}
          />
        </ChampConfiance>
      </fieldset>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={enCours}>
          {enCours ? t('commun:chargement.enCours') : t('scan:formulaire.valider')}
        </Button>
        <Button type="button" variant="outline" disabled={enCours} onClick={onAnnuler}>
          {t('commun:actions.annuler')}
        </Button>
      </div>
    </form>
  );
}
