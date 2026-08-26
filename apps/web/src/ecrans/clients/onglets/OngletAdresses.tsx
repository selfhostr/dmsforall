import { Pencil } from 'lucide-react';
import type { Dispatch, FormEvent, SetStateAction } from 'react';
import { useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import {
  npaSuisseValide,
  TYPES_ADRESSE,
  type ReponseClientAdresse,
  type TypeAdresse,
} from '@dfa/shared';

import { ErreurApi, messageErreur, messageErreurChamp } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label, LegendeChampsObligatoires } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useAdressesClient,
  useCreerAdresseClient,
  useModifierAdresseClient,
} from '@/hooks/clients/useAdressesClient';

import { EtatSousCollection } from './EtatSousCollection';

interface Props {
  readonly clientId: string;
}

/**
 * Pays admis à la saisie (issue #130) — `schemaCodePays` (`@dfa/shared`) accepte n'importe quel
 * code ISO 3166-1 alpha-2 à 2 lettres, sans liste fermée côté serveur ; cette liste est donc une
 * curation D'ÉCRAN (le cas réel cité par @laupernoe : clientèle frontalière d'un garage suisse), pas un
 * reflet d'une contrainte serveur. Seul `CH` déclenche la validation NPA à 4 chiffres
 * (`validerNpaSelonPays`, `packages/shared/src/contrats/atelier/client.ts`) : un NPA étranger
 * n'est donc jamais bloqué ici, à l'identique du serveur.
 */
const PAYS_ADRESSE = ['CH', 'DE', 'FR', 'IT', 'AT', 'LI'] as const;

interface ValeursFormulaireAdresse {
  readonly type: TypeAdresse;
  readonly rue: string;
  readonly npa: string;
  readonly localite: string;
  readonly pays: string;
}

function valeursVides(): ValeursFormulaireAdresse {
  return { type: 'principale', rue: '', npa: '', localite: '', pays: 'CH' };
}

function valeursDepuisAdresse(adresse: ReponseClientAdresse): ValeursFormulaireAdresse {
  return {
    type: adresse.type,
    rue: adresse.rue,
    npa: adresse.npa,
    localite: adresse.localite,
    pays: adresse.pays,
  };
}

/** Issue #119 — le NPA n'était vérifié qu'à la création du client (`FormulaireNouveauClient`,
 *  `schemaCreationClient`) : `3` et `75001` passaient tous deux ici, silencieusement acceptés par
 *  ce dialogue (aucune validation locale), refusés seulement par le serveur (`erreurServeur`) sans
 *  qu'aucun message ne dise pourquoi avant l'envoi. `npaSuisseValide` (`@dfa/shared`) est la MÊME
 *  fonction que celle appelée par `validerNpaSelonPays` côté contrat — jamais une regex retapée à
 *  la main ici, qui aurait pu diverger. */
function npaInvalideLocalement(valeurs: ValeursFormulaireAdresse): boolean {
  return valeurs.pays === 'CH' && valeurs.npa.trim() !== '' && !npaSuisseValide(valeurs.npa.trim());
}

function champsRemplis(valeurs: ValeursFormulaireAdresse): boolean {
  return Boolean(valeurs.rue.trim() && valeurs.npa.trim() && valeurs.localite.trim());
}

/** Fabrique un gestionnaire de champ commun aux DEUX dialogues (création, modification) — chaque
 *  frappe met à jour l'état local ET efface l'erreur serveur d'une tentative précédente (issue
 *  #132 : après avoir corrigé le champ « type » qui causait un conflit 400, l'ancien message
 *  restait affiché jusqu'à la soumission suivante — mesuré sur le doublon d'adresse active,
 *  défaut 3 du fichier de test). Une correction de saisie doit se lire comme un abandon de la
 *  tentative précédente, pas comme une simple frappe ignorée. */
function creerGestionnaireChamp(
  setValeurs: Dispatch<SetStateAction<ValeursFormulaireAdresse>>,
  mutation: { readonly isError: boolean; readonly reset: () => void },
) {
  return function <K extends keyof ValeursFormulaireAdresse>(
    champ: K,
    valeur: ValeursFormulaireAdresse[K],
  ) {
    setValeurs((valeurs) => ({ ...valeurs, [champ]: valeur }));
    if (mutation.isError) mutation.reset();
  };
}

interface PropsChampsAdresse {
  readonly idPrefixe: string;
  readonly valeurs: ValeursFormulaireAdresse;
  readonly onChamp: <K extends keyof ValeursFormulaireAdresse>(
    champ: K,
    valeur: ValeursFormulaireAdresse[K],
  ) => void;
  readonly erreurServeur: ErreurApi | null;
  readonly disabled: boolean;
}

/** Les cinq champs, partagés à l'identique entre « Ajouter une adresse » et « Modifier
 *  l'adresse » (issue #131) — une seule version à tenir à jour plutôt que deux copies qui
 *  auraient fini par diverger. */
function ChampsAdresse({
  idPrefixe,
  valeurs,
  onChamp,
  erreurServeur,
  disabled,
}: PropsChampsAdresse) {
  const { t } = useTranslation(['clients', 'commun']);
  const npaInvalide = npaInvalideLocalement(valeurs);
  const erreurNpaServeur = erreurServeur?.champErreur('npa');

  return (
    <>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefixe}-type`} requis>
          {t('clients:adresses.champs.type')}
        </Label>
        <Select value={valeurs.type} onValueChange={(v) => onChamp('type', v as TypeAdresse)}>
          <SelectTrigger
            id={`${idPrefixe}-type`}
            aria-label={t('clients:adresses.champs.type')}
            aria-invalid={erreurServeur?.champErreur('type') ? true : undefined}
            aria-required="true"
            disabled={disabled}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TYPES_ADRESSE.map((valeur) => (
              <SelectItem key={valeur} value={valeur}>
                {t(`clients:adresses.types.${valeur}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/* Défaut 3 : un doublon d'adresse active (« Une adresse « principale » active existe
            déjà. ») renvoyait un 400 parfaitement clair, perdu derrière le seul bandeau générique
            ci-dessous. Affiché ici, sur le champ que le serveur désigne
            (`erreurs[].champ === 'type'`). */}
        {erreurServeur?.champErreur('type') ? (
          <p className="texte-corps text-destructive">
            {messageErreurChamp(erreurServeur.champErreur('type')!, t)}
          </p>
        ) : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefixe}-rue`} requis>
          {t('clients:adresses.champs.rue')}
        </Label>
        <Input
          id={`${idPrefixe}-rue`}
          value={valeurs.rue}
          onChange={(e) => onChamp('rue', e.target.value)}
          aria-invalid={erreurServeur?.champErreur('rue') ? true : undefined}
          readOnly={disabled}
          required
        />
        {erreurServeur?.champErreur('rue') ? (
          <p className="texte-corps text-destructive">
            {messageErreurChamp(erreurServeur.champErreur('rue')!, t)}
          </p>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor={`${idPrefixe}-npa`} requis>
            {t('clients:adresses.champs.npa')}
          </Label>
          <Input
            id={`${idPrefixe}-npa`}
            value={valeurs.npa}
            onChange={(e) => onChamp('npa', e.target.value)}
            aria-invalid={erreurNpaServeur || npaInvalide ? true : undefined}
            aria-describedby={
              erreurNpaServeur || npaInvalide ? `${idPrefixe}-npa-erreur` : undefined
            }
            readOnly={disabled}
            required
          />
          {erreurNpaServeur ? (
            <p id={`${idPrefixe}-npa-erreur`} className="texte-corps text-destructive">
              {messageErreurChamp(erreurNpaServeur, t)}
            </p>
          ) : npaInvalide ? (
            <p id={`${idPrefixe}-npa-erreur`} className="texte-corps text-destructive">
              {t('clients:adresses.npaFormatInvalide')}
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefixe}-localite`} requis>
            {t('clients:adresses.champs.localite')}
          </Label>
          <Input
            id={`${idPrefixe}-localite`}
            value={valeurs.localite}
            onChange={(e) => onChamp('localite', e.target.value)}
            aria-invalid={erreurServeur?.champErreur('localite') ? true : undefined}
            readOnly={disabled}
            required
          />
          {erreurServeur?.champErreur('localite') ? (
            <p className="texte-corps text-destructive">
              {messageErreurChamp(erreurServeur.champErreur('localite')!, t)}
            </p>
          ) : null}
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefixe}-pays`} requis>
          {t('clients:adresses.champs.pays')}
        </Label>
        <Select value={valeurs.pays} onValueChange={(v) => onChamp('pays', v)}>
          <SelectTrigger
            id={`${idPrefixe}-pays`}
            aria-label={t('clients:adresses.champs.pays')}
            aria-invalid={erreurServeur?.champErreur('pays') ? true : undefined}
            className="w-40"
            disabled={disabled}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAYS_ADRESSE.map((code) => (
              <SelectItem key={code} value={code}>
                {t(`clients:adresses.pays.${code}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {erreurServeur?.champErreur('pays') ? (
          <p className="texte-corps text-destructive">
            {messageErreurChamp(erreurServeur.champErreur('pays')!, t)}
          </p>
        ) : null}
      </div>
    </>
  );
}

function libelleTypeAdresse(t: TFunction, adresse: ReponseClientAdresse): string {
  return t(`clients:adresses.types.${adresse.type}`);
}

/** Onglet « Adresses » (RM-03) — une seule adresse `principale`/`facturation` active à la fois
 *  (contrainte serveur, `service-client-sous-collections.ts`). */
export function OngletAdresses({ clientId }: Props) {
  const { t } = useTranslation(['clients', 'commun', 'erreurs']);
  const requete = useAdressesClient(clientId);
  const creerAdresse = useCreerAdresseClient(clientId);
  const modifierAdresse = useModifierAdresseClient(clientId);

  const [ouvert, setOuvert] = useState(false);
  const [valeurs, setValeurs] = useState<ValeursFormulaireAdresse>(valeursVides());
  const onChamp = creerGestionnaireChamp(setValeurs, creerAdresse);

  // Issue #131 : `null` = aucune modification en cours, l'adresse elle-même sert de source de
  // vérité pour préremplir le dialogue — pas un simple booléen `ouvert`, qui ne dirait pas
  // LAQUELLE des adresses éditer.
  const [adresseEnEdition, setAdresseEnEdition] = useState<ReponseClientAdresse | null>(null);
  const [valeursEdition, setValeursEdition] = useState<ValeursFormulaireAdresse>(valeursVides());
  const onChampEdition = creerGestionnaireChamp(setValeursEdition, modifierAdresse);

  const lignes = requete.data?.pages.flatMap((page) => page.donnees) ?? [];

  const soumettre = (evenement: FormEvent) => {
    evenement.preventDefault();
    if (!champsRemplis(valeurs) || npaInvalideLocalement(valeurs)) return;
    creerAdresse.mutate(
      {
        type: valeurs.type,
        rue: valeurs.rue.trim(),
        npa: valeurs.npa.trim(),
        localite: valeurs.localite.trim(),
        pays: valeurs.pays,
      },
      { onSuccess: () => setOuvert(false) },
    );
  };

  const changerOuvert = (valeur: boolean) => {
    setOuvert(valeur);
    // Efface l'erreur ET LES VALEURS d'une tentative précédente : sans ce geste, rouvrir le
    // dialogue pour une NOUVELLE saisie laisse les anciennes valeurs en place (le dialogue n'est
    // pas garanti démonté entre deux ouvertures — `DialogContent` de Radix, comme `SheetContent`),
    // et une saisie suivante s'insère dans l'ancienne au lieu de la remplacer. Même défaut, même
    // correctif que `FormulaireNouveauClient` (défaut 1, corruption de saisie constatée en base
    // sur le tiroir « Nouveau client »).
    if (valeur) {
      creerAdresse.reset();
      setValeurs(valeursVides());
    }
  };

  const ouvrirEdition = (adresse: ReponseClientAdresse) => {
    modifierAdresse.reset();
    setValeursEdition(valeursDepuisAdresse(adresse));
    setAdresseEnEdition(adresse);
  };

  const changerOuvertEdition = (valeur: boolean) => {
    if (!valeur) {
      setAdresseEnEdition(null);
      return;
    }
    // Ouverture programmatique uniquement (`ouvrirEdition` ci-dessus, jamais un `DialogTrigger`
    // direct) : rien à faire ici, `adresseEnEdition` porte déjà l'état.
  };

  const soumettreEdition = (evenement: FormEvent) => {
    evenement.preventDefault();
    if (!adresseEnEdition) return;
    if (!champsRemplis(valeursEdition) || npaInvalideLocalement(valeursEdition)) return;
    modifierAdresse.mutate(
      {
        adresseId: adresseEnEdition.id,
        entree: {
          type: valeursEdition.type,
          rue: valeursEdition.rue.trim(),
          npa: valeursEdition.npa.trim(),
          localite: valeursEdition.localite.trim(),
          pays: valeursEdition.pays,
        },
      },
      { onSuccess: () => setAdresseEnEdition(null) },
    );
  };

  const erreurServeur = creerAdresse.error instanceof ErreurApi ? creerAdresse.error : null;
  const erreurServeurEdition =
    modifierAdresse.error instanceof ErreurApi ? modifierAdresse.error : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="texte-titre-section font-medium text-foreground">
          {t('clients:adresses.titre')}
        </h3>
        <Dialog open={ouvert} onOpenChange={changerOuvert}>
          <DialogTrigger asChild>
            <Button type="button" size="sm" variant="outline">
              {t('clients:adresses.ajouter')}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('clients:adresses.ajouter')}</DialogTitle>
            </DialogHeader>
            <LegendeChampsObligatoires>
              {t('commun:formulaires.champsObligatoiresLegende')}
            </LegendeChampsObligatoires>
            <form onSubmit={soumettre} noValidate className="space-y-3">
              <ChampsAdresse
                idPrefixe="adresse"
                valeurs={valeurs}
                onChamp={onChamp}
                erreurServeur={erreurServeur}
                disabled={creerAdresse.isPending}
              />
              {creerAdresse.isError ? (
                <p className="texte-libelle text-destructive" role="alert">
                  {messageErreur(creerAdresse.error, t)}
                </p>
              ) : null}
              <DialogFooter>
                <Button
                  type="submit"
                  disabled={
                    creerAdresse.isPending ||
                    !champsRemplis(valeurs) ||
                    npaInvalideLocalement(valeurs)
                  }
                >
                  {t('commun:actions.ajouter')}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <EtatSousCollection
        enChargement={requete.isLoading}
        erreur={requete.error}
        onReessayer={() => void requete.refetch()}
        vide={lignes.length === 0}
        texteVide={t('clients:adresses.vide')}
      >
        {/* `divide-y` (filet seul entre lignes) — même motif que `PanneauTravauxReportes.tsx`
         *  (vehicules/), DESIGN.md « bordure structurelle uniquement ». */}
        <ul className="divide-y">
          {lignes.map((adresse) => (
            <li key={adresse.id} className="py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="texte-libelle rounded-full border px-2 py-0.5 text-muted-foreground">
                  {t(`clients:adresses.types.${adresse.type}`)}
                </span>
                <div className="flex items-center gap-1">
                  {!adresse.actif ? (
                    <span className="texte-libelle text-muted-foreground">
                      {t('clients:liste.statuts.inactif')}
                    </span>
                  ) : null}
                  {/* Issue #131 : seul « Ajouter une adresse » existait, aucune affordance de
                      modification — bouton icône TOUJOURS visible (pas de survol seul : la
                      cible réelle est une tablette de comptoir, sans souris). */}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t('clients:adresses.modifierAriaLabel', {
                      type: libelleTypeAdresse(t, adresse),
                    })}
                    onClick={() => ouvrirEdition(adresse)}
                  >
                    <Pencil aria-hidden className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <p className="texte-corps text-foreground">
                {adresse.rue}
                {adresse.complement ? `, ${adresse.complement}` : ''}
              </p>
              <p className="texte-corps text-foreground">
                {adresse.npa} {adresse.localite}
              </p>
            </li>
          ))}
        </ul>
      </EtatSousCollection>

      <Dialog open={adresseEnEdition !== null} onOpenChange={changerOuvertEdition}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('clients:adresses.modifier')}</DialogTitle>
          </DialogHeader>
          <LegendeChampsObligatoires>
            {t('commun:formulaires.champsObligatoiresLegende')}
          </LegendeChampsObligatoires>
          <form onSubmit={soumettreEdition} noValidate className="space-y-3">
            <ChampsAdresse
              idPrefixe="adresse-modifier"
              valeurs={valeursEdition}
              onChamp={onChampEdition}
              erreurServeur={erreurServeurEdition}
              disabled={modifierAdresse.isPending}
            />
            {modifierAdresse.isError ? (
              <p className="texte-libelle text-destructive" role="alert">
                {messageErreur(modifierAdresse.error, t)}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="submit"
                disabled={
                  modifierAdresse.isPending ||
                  !champsRemplis(valeursEdition) ||
                  npaInvalideLocalement(valeursEdition)
                }
              >
                {t('commun:actions.enregistrer')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
