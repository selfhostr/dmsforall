import { AlertCircle, Plus, WifiOff, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import {
  schemaCreationOrdreReparation,
  TYPES_ORDRE_REPARATION,
  type EntreeCreationOrdreReparation,
  type ReponseClient,
  type ReponseOrdreReparation,
  type StatutInitialOrdreReparation,
  type TypeOrdreReparation,
  type VehiculeResume,
} from '@dfa/shared';

import { ErreurReseau } from '@/api/erreurs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { DatetimeInput } from '@/components/ui/datetime-input';
import { Input } from '@/components/ui/input';
import { Label, LegendeChampsObligatoires } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ChampKilometrage } from '@/composants/comptoir/ChampKilometrage';
import { ChampMontant } from '@/composants/comptoir/ChampMontant';
import { AvertissementConfirmable } from '@/composants/motifs/AvertissementConfirmable';
import { BandeauBrouillon } from '@/composants/motifs/BandeauBrouillon';
import { useCreationOrdreReparation } from '@/hooks/atelier/useCreationOrdreReparation';
import { effacerBrouillon, lireBrouillon } from '@/hooks/brouillon/brouillon';
import { useSauvegardeBrouillon } from '@/hooks/brouillon/useSauvegardeBrouillon';
import { useParametresAtelier } from '@/hooks/parametres/useParametresAtelier';
import { useContexteAtelier } from '@/hooks/vehicules/useContexteAtelier';
import { chemins } from '@/routes/chemins';
import { cn } from '@/lib/utils';

import { messageErreurMutation } from './messages-erreur-mutation';

interface Props {
  readonly site: string;
  readonly client: ReponseClient;
  readonly vehicule: VehiculeResume;
  readonly onChangerVehicule: () => void;
  readonly onCree: (or: ReponseOrdreReparation) => void;
}

/** Défaut assumé : « réparation » est le mot même de l'OR et le motif le plus fréquent au
 *  comptoir — un défaut n'est jamais neutre, mais laisser le champ vide forcerait un clic
 *  supplémentaire sur le cas le plus courant. */
const TYPE_PAR_DEFAUT: TypeOrdreReparation = 'reparation';

/** `demandes` et les deux champs à borne numérique (`kilometrageEntree`, `plafondCentimes`) sont
 *  les seuls dont une saisie comptoir peut réellement violer le schéma serveur (dépassement de
 *  9'999'999 km, montant négatif) — les autres champs texte sont bornés à la frappe (`maxLength`)
 *  et ne produisent donc jamais d'erreur de validation à ce stade. Un message générique suffit
 *  pour tout le reste (défaut serveur inattendu, jamais vu en pratique). */
interface ErreursChamps {
  kilometrageEntree?: string;
  plafondCentimes?: string;
}

/** Champs couverts par le brouillon local (issue #77) : `demandes` (l'array déjà « ajouté ») ET
 *  `demandeSaisie` (le texte encore dans la zone de saisie, pas encore « + Ajouté ») — la demande
 *  la plus coûteuse à reperdre est souvent celle qu'on est justement en train de taper au moment
 *  d'une panne. `kilometrageEntree` est l'autre champ nommé par le testeur terrain (issue #77).
 *  Volontairement PAS le reste du formulaire (plafond, PO, restitution…) : portée étroite au
 *  strict nécessaire décrit par l'incident, pas un brouillon générique de tout le formulaire. */
interface ValeursBrouillonNouvelOr {
  readonly demandes: readonly string[];
  readonly demandeSaisie: string;
  readonly kilometrageEntree: number | null;
}

/** `useSauvegardeBrouillon` réécrit sans condition à chaque changement des trois champs couverts
 *  — y compris juste après `ignorerBrouillon()`, qui les remet à vide : un brouillon « vide »
 *  finit donc réellement réécrit dans `sessionStorage` (harmless en soi, mais un ARTEFACT, jamais
 *  une intention). Sans ce garde-fou, `BandeauBrouillon` réapparaîtrait à la prochaine ouverture
 *  du formulaire pour annoncer la reprise... de rien — exactement le genre de bandeau qui fait
 *  perdre confiance dans le mécanisme. Traité comme une ABSENCE de brouillon, jamais comme une
 *  reprise à afficher. */
function brouillonEstVide(valeurs: ValeursBrouillonNouvelOr): boolean {
  return (
    valeurs.demandes.length === 0 &&
    valeurs.demandeSaisie.trim() === '' &&
    valeurs.kilometrageEntree === null
  );
}

/**
 * Le corps du formulaire d'ouverture d'OR (§7.6) — champs libres, une fois `site`/`client`/
 * `vehicule` connus (portés par `EcranNouvelOrdreReparation`, jamais redécidés ici). Tous les
 * champs sont ici gérés en état local contrôlé (comme `PanneauActionsOr`, le voisin naturel de ce
 * module) plutôt que via `react-hook-form` : `ChampKilometrage`/`ChampMontant` sont des composants
 * contrôlés valeur/`onChange`, pas des champs `register()`-ables, et la validation finale passe
 * par `schemaCreationOrdreReparation.safeParse` — la même source de vérité que le serveur.
 *
 * Rien n'est obligatoire ici que le contrat n'exige déjà (`type` seul, les uuid étant fournis par
 * le parent) : un OR s'ouvre avec le minimum, le reste (kilométrage, plafond, PO, restitution) se
 * complète depuis la fiche ensuite (`PATCH /ordres-reparation/{id}`, écran existant).
 */
export function FormulaireNouvelOrdreReparation({
  site,
  client,
  vehicule,
  onChangerVehicule,
  onCree,
}: Props) {
  const { t } = useTranslation(['or', 'commun', 'erreurs', 'validation']);
  const parametresAtelier = useParametresAtelier();
  const creation = useCreationOrdreReparation();
  // Déjà chargé par `EcranFicheVehicule` pour ce même véhicule dans le parcours normal (choix
  // depuis la fiche) — même clé de cache (`clesQuery.vehicules.contexteAtelier`), donc pas de
  // requête réseau supplémentaire dans ce cas. Sert UNIQUEMENT à NOMMER les OR déjà ouverts dans
  // la confirmation ci-dessous (issues #64/#66, « voici lesquels ») ; son absence ou son chargement
  // encore en cours ne bloque rien — `descriptionConfirmation` retombe alors sur le message
  // générique du serveur.
  const contexteAtelier = useContexteAtelier(vehicule.id);

  // Issue #77 : un réceptionniste a perdu trois fois la demande client et le kilométrage saisis
  // ici quand `RouteProtegee` démontait tout l'écran sur une panne réseau passagère. Clé stable
  // dès le premier rendu (`vehicule` est un prop requis, jamais inconnu à ce stade) — voir
  // `hooks/brouillon/brouillon.ts` pour la doctrine (sessionStorage, jamais pour éditer une
  // ressource déjà persistée). Lu UNE SEULE fois à l'ouverture (`useState` paresseux, pas un effet
  // qui réécrirait la saisie en cours à chaque changement de `vehicule.id`) : ce formulaire est
  // toujours (re)monté pour un véhicule choisi une fois par le parent, jamais réutilisé en place
  // pour un second véhicule.
  const cleBrouillon = `or-nouveau.${vehicule.id}`;
  const [brouillonInitial] = useState(() => lireBrouillon<ValeursBrouillonNouvelOr>(cleBrouillon));

  const [type, setType] = useState<TypeOrdreReparation>(TYPE_PAR_DEFAUT);
  const [statutInitial, setStatutInitial] = useState<StatutInitialOrdreReparation>('ouvert');
  const [demandeSaisie, setDemandeSaisie] = useState(
    () => brouillonInitial?.valeurs.demandeSaisie ?? '',
  );
  const [demandes, setDemandes] = useState<readonly string[]>(
    () => brouillonInitial?.valeurs.demandes ?? [],
  );
  const [kilometrageEntree, setKilometrageEntree] = useState<number | null>(
    () => brouillonInitial?.valeurs.kilometrageEntree ?? null,
  );
  // Distinct de `brouillonInitial` : reste posé tant que l'utilisateur n'a pas explicitement
  // rejeté la reprise (`ignorerBrouillon`) — sert UNIQUEMENT à piloter `BandeauBrouillon`, jamais
  // à revalider quoi que ce soit côté saisie.
  const [brouillonRepriseLe, setBrouillonRepriseLe] = useState<string | null>(() =>
    brouillonInitial && !brouillonEstVide(brouillonInitial.valeurs)
      ? brouillonInitial.enregistreLe
      : null,
  );
  const [plafondCentimes, setPlafondCentimes] = useState<number | null>(null);
  const [plafondAutorisePar, setPlafondAutorisePar] = useState('');
  const [restitutionSaisie, setRestitutionSaisie] = useState('');
  const [numeroCommandeInterne, setNumeroCommandeInterne] = useState('');
  const [conducteurPresentNom, setConducteurPresentNom] = useState('');
  const [erreursChamps, setErreursChamps] = useState<ErreursChamps>({});
  const [erreurGenerique, setErreurGenerique] = useState<string | null>(null);
  // Issues #64/#66 (test terrain, 12.08.2026) : un réceptionniste a cliqué TROIS FOIS sur
  // « Ouvrir l'ordre de réparation » sans rien voir se passer — le serveur répondait bien
  // `409 CONFIRMATION_REQUISE`/`VEHICULE_DEUX_OR_OUVERTS`, mais l'encart qui le disait vivait tout
  // en HAUT de l'écran (juste sous la carte véhicule) pendant que le bouton cliqué était tout en
  // BAS : hors du champ visuel de l'action, un second clic silencieux était le résultat le plus
  // probable. Retenu un `useState` de REJET plutôt qu'un simple `confirmationsRequises.length > 0`
  // : la modale (voir plus bas) s'ouvre désormais D'ELLE-MÊME dès que le serveur exige une
  // confirmation (même mécanisme que `DialogueNouveauRendezVous`, `composants/rendez-vous/` — la
  // référence explicite plutôt qu'un quatrième mécanisme inventé ici), mais `confirmationsRequises`
  // reste posé côté hook tant qu'aucun nouvel envoi n'a eu lieu (`useCreationOrdreReparation` n'a
  // pas de `reset()`) : sans ce drapeau, fermer la modale par « Annuler » la rouvrirait aussitôt,
  // rendant le refus impossible — exactement ce que le coordinateur a exclu.
  const [confirmationRejetee, setConfirmationRejetee] = useState(false);

  const etatPlanifieActif = parametresAtelier.data?.or.etatPlanifieActif ?? false;
  // Le kilométrage est exigé par le SERVEUR (`OR_KM_ENTREE_REQUIS`, RM-51) quand le garage l'a
  // paramétré (`reception.kmEntreeObligatoire`) ET que l'OR s'ouvre tout de suite (`ouvert`, pas
  // `planifie`) : le champ doit le dire AVANT l'envoi — astérisque + `aria-required` — plutôt que
  // de laisser découvrir l'obligation par un refus.
  const kilometrageObligatoire =
    (parametresAtelier.data?.reception.kmEntreeObligatoire ?? false) && statutInitial === 'ouvert';

  // Sauvegarde AUTOMATIQUE à chaque changement de l'un des trois champs couverts (issue #77) —
  // voir `ValeursBrouillonNouvelOr` pour la justification de cette portée précise.
  useSauvegardeBrouillon<ValeursBrouillonNouvelOr>(cleBrouillon, {
    demandes,
    demandeSaisie,
    kilometrageEntree,
  });

  function ajouterDemande() {
    const verbatim = demandeSaisie.trim();
    if (verbatim === '' || verbatim.length > 4000) return;
    setDemandes((valeur) => [...valeur, verbatim]);
    setDemandeSaisie('');
  }

  function retirerDemande(index: number) {
    setDemandes((valeur) => valeur.filter((_, i) => i !== index));
  }

  /** Rejet EXPLICITE du brouillon repris (exigence n°2, `BandeauBrouillon` sans ce geste ne ferait
   *  que l'annoncer, jamais permettre de l'écarter) : remet les trois champs couverts à vide et
   *  efface le stockage local — un formulaire qui se serait rempli tout seul sans offrir de retour
   *  arrière ferait douter de ce qu'on envoie réellement. */
  function ignorerBrouillon() {
    effacerBrouillon(cleBrouillon);
    setDemandes([]);
    setDemandeSaisie('');
    setKilometrageEntree(null);
    setBrouillonRepriseLe(null);
  }

  /**
   * Demandes réellement soumises = `demandes` (déjà « ajoutées ») + le texte encore dans le champ
   * de saisie, s'il n'est pas vide (CORRECTIF — test d'utilisabilité novice, 11.08.2026) :
   * « le mécanicien reçoit une voiture sans savoir pourquoi elle est là » — un texte tapé puis
   * jamais explicitement « + Ajouté » ne doit JAMAIS disparaître silencieusement à la soumission,
   * c'est la seule information vraiment importante de tout l'écran. Choix retenu (vs. bloquer la
   * soumission en exigeant l'ajout explicite) : conserver SANS geste supplémentaire — le « +
   * Ajouter » garde son utilité pour composer PLUSIEURS demandes distinctes, mais n'est plus une
   * condition pour que la première survive. Recalculé à chaque appel (jamais mémorisé dans un
   * state à part) : idempotent si `soumettre()` est rappelé après une erreur serveur, sans risque
   * de dupliquer la phrase en attente.
   */
  function demandesEffectives(): readonly string[] {
    const enAttente = demandeSaisie.trim();
    return enAttente === '' ? demandes : [...demandes, enAttente];
  }

  function construireEntree(): EntreeCreationOrdreReparation {
    return {
      siteId: site,
      clientId: client.id,
      vehiculeId: vehicule.id,
      type,
      statutInitial,
      kilometrageEntree,
      uniteKilometrage: 'km',
      demandes: demandesEffectives().map((verbatim) => ({ verbatim })),
      plafondCentimes: plafondCentimes ?? undefined,
      plafondAutorisePar: plafondAutorisePar.trim() === '' ? undefined : plafondAutorisePar.trim(),
      // `restitutionSaisie` est DÉJÀ un ISO correctement converti — `DatetimeInput.onChange`
      // (`components/ui/datetime-input.tsx`) le rend directement. Ne PAS repasser par
      // `new Date(restitutionSaisie).toISOString()` : ce champ contenait un `<input
      // type="datetime-local">` NAÏF (ni fuseau ni ISO, format navigateur — issue #89, décalage
      // constaté l'été comme l'hiver), `DatetimeInput` a corrigé le fond, réappliquer une
      // conversion par-dessus réintroduirait le même décalage qu'on vient d'éliminer.
      restitutionPromiseLe: restitutionSaisie === '' ? undefined : restitutionSaisie,
      conducteurPresentNom:
        conducteurPresentNom.trim() === '' ? undefined : conducteurPresentNom.trim(),
      numeroCommandeInterne:
        numeroCommandeInterne.trim() === '' ? undefined : numeroCommandeInterne.trim(),
    };
  }

  function soumettre() {
    setErreursChamps({});
    setErreurGenerique(null);
    setConfirmationRejetee(false);
    const entree = construireEntree();
    const resultat = schemaCreationOrdreReparation.safeParse(entree);
    if (!resultat.success) {
      const parChamp: ErreursChamps = {};
      let autre = false;
      for (const probleme of resultat.error.issues) {
        const chemin = probleme.path[0];
        if (chemin === 'kilometrageEntree')
          parChamp.kilometrageEntree = t('or:nouveau.champs.kmInvalide');
        else if (chemin === 'plafondCentimes')
          parChamp.plafondCentimes = t('or:nouveau.champs.plafondInvalide');
        else autre = true;
      }
      setErreursChamps(parChamp);
      if (autre) setErreurGenerique(t('validation:requis'));
      return;
    }
    creation.soumettre(resultat.data, {
      // Effacé UNIQUEMENT sur un succès serveur confirmé (exigence n°1, issue #77) : un OR ouvert
      // avec succès rend le brouillon local obsolète — le laisser vivre ferait resurgir la demande
      // du CLIENT PRÉCÉDENT dans le formulaire suivant, envoyée sans relecture parce qu'on croirait
      // reconnaître sa propre saisie. Jamais sur un simple échec de soumission (validation locale
      // ou refus serveur) : l'utilisateur doit encore pouvoir corriger et renvoyer sans retaper.
      onSuccess: (or) => {
        effacerBrouillon(cleBrouillon);
        onCree(or);
      },
    });
  }

  const enCours = creation.enCours;
  const estErreurReseau = creation.erreur instanceof ErreurReseau;
  // Refus simple (§3.2/§3.4) contre CONFIRMATION_REQUISE (§4.4) : les deux sont mutuellement
  // exclusifs (`creation.erreur` est `null` tant qu'une confirmation reste à traiter, voir
  // `useCreationOrdreReparation`) — même distinction que `PanneauActionsOr`, le voisin naturel de
  // cet écran dans le module atelier.
  const confirmationsRequises = creation.confirmationsRequises;

  /** Le message serveur générique (« Un ordre de réparation est déjà ouvert pour ce véhicule. »)
   *  ne dit pas LEQUEL — un réceptionniste qui gère plusieurs OR par jour ne peut pas juger sans
   *  ouvrir un second écran. Nomme les OR déjà ouverts quand `contexteAtelier` les connaît déjà ;
   *  retombe sur le message serveur sinon (chargement encore en cours, ou requête distincte
   *  échouée — l'un n'empêche jamais l'autre, la confirmation reste utilisable dans les deux cas). */
  const orsOuverts = contexteAtelier.data?.ordresReparationOuverts ?? [];
  const deuxOrOuverts =
    confirmationsRequises.includes('VEHICULE_DEUX_OR_OUVERTS') && orsOuverts.length > 0;

  function descriptionConfirmation(): string {
    if (deuxOrOuverts) {
      return t('or:nouveau.confirmation.vehiculeDeuxOrOuverts', {
        numeros: orsOuverts.map((or) => or.numero).join(', '),
      });
    }
    return creation.erreurActive ? messageErreurMutation(creation.erreurActive, t) : '';
  }

  return (
    <div className="flex flex-col gap-5">
      {/* DESIGN.md « bordure structurelle uniquement » — résumé de lecture (véhicule + bouton
       *  « Modifier »), pas une zone d'action à isoler : `border` remplacé par une surface tonale,
       *  même mécanisme que `Card`. */}
      <div className="flex items-center justify-between gap-3 rounded-md bg-muted/40 p-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="texte-libelle text-muted-foreground">
            {t('or:nouveau.vehicule.titre')}
          </span>
          <span className="truncate texte-corps font-medium text-foreground">
            {vehicule.designation}
          </span>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onChangerVehicule}
          disabled={enCours}
        >
          {t('commun:actions.modifier')}
        </Button>
      </div>

      {/* Issue #77 : signale ET permet de rejeter une saisie restaurée — un formulaire qui se
       *  remplit tout seul sans le dire ferait douter de ce qu'on est en train d'envoyer.
       *  `BandeauBrouillon` (partagé) ne porte pas de bouton de rejet lui-même (présentation
       *  seule) : le geste vit ici, propre à ce formulaire. */}
      {brouillonRepriseLe ? (
        <div className="flex items-center gap-2">
          <BandeauBrouillon repriseLe={brouillonRepriseLe} className="flex-1" />
          <Button type="button" variant="outline" size="sm" onClick={ignorerBrouillon}>
            {t('or:nouveau.actions.ignorerBrouillon')}
          </Button>
        </div>
      ) : null}

      {creation.erreur ? (
        <Alert variant={estErreurReseau ? 'avertissement' : 'destructive'}>
          {estErreurReseau ? (
            <WifiOff className="h-4 w-4" aria-hidden="true" />
          ) : (
            <AlertCircle className="h-4 w-4" aria-hidden="true" />
          )}
          <AlertTitle>
            {t(estErreurReseau ? 'erreurs:reseau.titre' : 'or:nouveau.erreur.titre')}
          </AlertTitle>
          <AlertDescription>{messageErreurMutation(creation.erreur, t)}</AlertDescription>
        </Alert>
      ) : null}

      <LegendeChampsObligatoires>
        {t('commun:formulaires.champsObligatoiresLegende')}
      </LegendeChampsObligatoires>

      <div className="space-y-2">
        <Label htmlFor="or-nouveau-type" requis>
          {t('or:nouveau.type.libelle')}
        </Label>
        <Select value={type} onValueChange={(valeur) => setType(valeur as TypeOrdreReparation)}>
          <SelectTrigger
            id="or-nouveau-type"
            aria-label={t('or:nouveau.type.libelle')}
            aria-required="true"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TYPES_ORDRE_REPARATION.map((valeur) => (
              <SelectItem key={valeur} value={valeur}>
                {t(`or:nouveau.type.${valeur}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {etatPlanifieActif ? (
        <div className="space-y-2">
          <Label>{t('or:nouveau.champs.statutInitial')}</Label>
          <div
            role="group"
            aria-label={t('or:nouveau.champs.statutInitial')}
            className="inline-flex overflow-hidden rounded-md border"
          >
            {(
              ['ouvert', 'planifie'] as const satisfies readonly StatutInitialOrdreReparation[]
            ).map((valeur) => (
              <button
                key={valeur}
                type="button"
                aria-pressed={statutInitial === valeur}
                onClick={() => setStatutInitial(valeur)}
                disabled={enCours}
                className={cn(
                  'h-11 px-4 texte-corps font-medium transition-colors',
                  statutInitial === valeur
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background text-foreground hover:bg-muted',
                )}
              >
                {t(`or:statuts.${valeur}`)}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* DESIGN.md « bordure structurelle uniquement » — CONSERVÉE ici, à la différence des
       *  fieldsets voisins retirés ci-dessus/dessous : ce groupe porte son propre comportement
       *  (ajouter/retirer une demande, une mini-liste éditable), pas un simple regroupement de
       *  champs statiques — la bordure sépare une zone dont le comportement diffère réellement. */}
      <fieldset className="space-y-2 rounded-md border p-3">
        <legend className="px-1 texte-libelle font-medium text-foreground">
          {t('or:demandes.titre')}
        </legend>
        <p className="texte-libelle text-muted-foreground">{t('or:demandes.aide')}</p>
        {demandes.length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {demandes.map((verbatim, index) => (
              <li
                key={index}
                className="flex items-start justify-between gap-2 rounded-md bg-muted p-2 texte-corps"
              >
                <span className="min-w-0 flex-1">« {verbatim} »</span>
                <button
                  type="button"
                  aria-label={t('or:nouveau.demandes.retirer')}
                  onClick={() => retirerDemande(index)}
                  disabled={enCours}
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex gap-2">
          <Textarea
            aria-label={t('or:demandes.verbatim')}
            placeholder={t('or:nouveau.demandes.placeholder')}
            value={demandeSaisie}
            disabled={enCours}
            rows={2}
            onChange={(evenement) => setDemandeSaisie(evenement.target.value)}
            onKeyDown={(evenement) => {
              if (evenement.key === 'Enter' && !evenement.shiftKey) {
                evenement.preventDefault();
                ajouterDemande();
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            onClick={ajouterDemande}
            disabled={enCours || demandeSaisie.trim() === ''}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t('or:demandes.ajouter')}
          </Button>
        </div>
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <ChampKilometrage
          valeur={kilometrageEntree}
          onChangeValeur={setKilometrageEntree}
          unite="km"
          label={t('or:actions.kilometrageEntree')}
          erreur={erreursChamps.kilometrageEntree}
          obligatoire={kilometrageObligatoire}
          disabled={enCours}
        />
        <p className="texte-libelle text-muted-foreground">{t('or:actions.kilometrageAide')}</p>
      </div>

      {/* DESIGN.md « bordure structurelle uniquement » — champs indépendants sans action propre
       *  (contrairement au fieldset « demandes » ci-dessus, qui gère son propre ajout/retrait de
       *  liste) : `border` remplacé par une surface tonale, `legend` porte déjà le titre du
       *  groupe. */}
      <fieldset className="space-y-3 rounded-md bg-muted/40 p-3">
        <legend className="px-1 texte-libelle font-medium text-foreground">
          {t('or:nouveau.champs.avance')}
        </legend>

        <div className="grid grid-cols-2 gap-3">
          <ChampMontant
            valeurCentimes={plafondCentimes}
            onChangeCentimes={setPlafondCentimes}
            label={t('or:plafond.libelle')}
            erreur={erreursChamps.plafondCentimes}
            disabled={enCours}
          />
          <div className="space-y-2">
            <Label htmlFor="or-nouveau-plafond-autorise-par">{t('or:plafond.autorisePar')}</Label>
            <Input
              id="or-nouveau-plafond-autorise-par"
              maxLength={200}
              disabled={enCours}
              value={plafondAutorisePar}
              onChange={(evenement) => setPlafondAutorisePar(evenement.target.value)}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="or-nouveau-restitution">{t('or:bandeau.restitutionPromise')}</Label>
          {/* Issue #89 : `<input type="datetime-local">` natif affichait la date au format du
           *  système d'exploitation (`mm/dd/yyyy` constaté sur le terrain), jamais `jj.mm.aaaa`
           *  comme le reste du produit. `DatetimeInput` rend déjà une valeur ISO correctement
           *  convertie — voir le commentaire de `restitutionPromiseLe` dans `construireEntree`
           *  ci-dessus : ne jamais lui faire subir une seconde conversion. */}
          <DatetimeInput
            id="or-nouveau-restitution"
            disabled={enCours}
            value={restitutionSaisie}
            onChange={(valeurISO) => setRestitutionSaisie(valeurISO ?? '')}
          />
        </div>

        <div className="space-y-2">
          {/* Étoile CONDITIONNELLE (RM-14) : `numeroCommandeInterne` est `.nullish()` dans
           *  `schemaCreationOrdreReparation` — le contrat ne l'exige jamais statiquement, c'est
           *  `client.poObligatoire` (fiche client) qui le rend obligatoire pour CE client
           *  précis, refusé serveur par `409 OR_PO_MANQUANT` sinon. Remplace l'ancien `' *'`
           *  codé en dur (pas `aria-hidden`, jamais annoncé comme obligatoire à un lecteur
           *  d'écran) par le mécanisme partagé. */}
          <Label htmlFor="or-nouveau-po" requis={client.poObligatoire}>
            {t('or:bandeau.numeroPo')}
          </Label>
          <Input
            id="or-nouveau-po"
            maxLength={60}
            disabled={enCours}
            value={numeroCommandeInterne}
            aria-required={client.poObligatoire || undefined}
            onChange={(evenement) => setNumeroCommandeInterne(evenement.target.value)}
          />
          {client.poObligatoire ? (
            <p className="texte-libelle text-muted-foreground">{t('or:refus.poManquant')}</p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="or-nouveau-conducteur">
            {t('or:nouveau.champs.conducteurPresentNom')}
          </Label>
          <Input
            id="or-nouveau-conducteur"
            maxLength={200}
            disabled={enCours}
            value={conducteurPresentNom}
            onChange={(evenement) => setConducteurPresentNom(evenement.target.value)}
          />
        </div>
      </fieldset>

      {erreurGenerique ? <p className="texte-libelle text-destructive">{erreurGenerique}</p> : null}

      <Button type="button" className="w-full" disabled={enCours} onClick={soumettre}>
        {enCours ? t('or:nouveau.actions.enCours') : t('or:nouveau.actions.creer')}
      </Button>

      {/* CONFIRMATION_REQUISE (§4.4, issues #64/#66) : s'ouvre D'ELLE-MÊME dès que le serveur
       *  l'exige, jamais derrière un second clic sur un encart qu'on peut manquer — même mécanisme
       *  que `DialogueNouveauRendezVous` (`composants/rendez-vous/`) pour ce même refus
       *  `VEHICULE_DEUX_OR_OUVERTS`. La modale de Radix déplace le focus clavier à l'ouverture,
       *  donc autant l'œil que le clavier tombent directement sur la question, plutôt que devoir
       *  remonter en haut de l'écran pour la trouver. Le refus reste un geste normal (`Annuler`,
       *  Échap) : `confirmationRejetee` l'enregistre pour ne pas rouvrir la modale toute seule —
       *  reposer la question exige un nouvel envoi explicite (voir `soumettre` ci-dessus). */}
      <AvertissementConfirmable
        ouvert={confirmationsRequises.length > 0 && !confirmationRejetee}
        onOuvertChange={(ouvertConfirmation) => {
          if (!ouvertConfirmation) setConfirmationRejetee(true);
        }}
        titre={t('or:nouveau.titre')}
        description={descriptionConfirmation()}
        libelleConfirmation={t('commun:actions.continuerQuandMeme')}
        onConfirmer={() => creation.confirmerEtResoumettre({ onSuccess: onCree })}
        enCours={enCours}
      >
        {deuxOrOuverts ? (
          <ul className="flex flex-col gap-1">
            {orsOuverts.map((orOuvert) => (
              <li key={orOuvert.id}>
                <Link
                  to={chemins.atelier.ordresReparation.detail(orOuvert.id, site)}
                  target="_blank"
                  rel="noreferrer"
                  className="texte-corps font-medium text-primary underline underline-offset-2"
                >
                  {t('or:nouveau.confirmation.ouvrirOr', { numero: orOuvert.numero })}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </AvertissementConfirmable>
    </div>
  );
}
