import { AlertCircle, Plus, WifiOff, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

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

import { ErreurReseau, messageErreur } from '@/api/erreurs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ChampKilometrage } from '@/composants/comptoir/ChampKilometrage';
import { ChampMontant } from '@/composants/comptoir/ChampMontant';
import { AvertissementConfirmable } from '@/composants/motifs/AvertissementConfirmable';
import { useCreationOrdreReparation } from '@/hooks/atelier/useCreationOrdreReparation';
import { useParametresAtelier } from '@/hooks/parametres/useParametresAtelier';
import { cn } from '@/lib/utils';

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
export function FormulaireNouvelOrdreReparation({ site, client, vehicule, onChangerVehicule, onCree }: Props) {
  const { t } = useTranslation(['or', 'commun', 'erreurs', 'validation']);
  const parametresAtelier = useParametresAtelier();
  const creation = useCreationOrdreReparation();

  const [type, setType] = useState<TypeOrdreReparation>(TYPE_PAR_DEFAUT);
  const [statutInitial, setStatutInitial] = useState<StatutInitialOrdreReparation>('ouvert');
  const [demandeSaisie, setDemandeSaisie] = useState('');
  const [demandes, setDemandes] = useState<readonly string[]>([]);
  const [kilometrageEntree, setKilometrageEntree] = useState<number | null>(null);
  const [plafondCentimes, setPlafondCentimes] = useState<number | null>(null);
  const [plafondAutorisePar, setPlafondAutorisePar] = useState('');
  const [restitutionSaisie, setRestitutionSaisie] = useState('');
  const [numeroCommandeInterne, setNumeroCommandeInterne] = useState('');
  const [conducteurPresentNom, setConducteurPresentNom] = useState('');
  const [erreursChamps, setErreursChamps] = useState<ErreursChamps>({});
  const [erreurGenerique, setErreurGenerique] = useState<string | null>(null);
  const [confirmationOuverte, setConfirmationOuverte] = useState(false);

  const etatPlanifieActif = parametresAtelier.data?.or.etatPlanifieActif ?? false;

  function ajouterDemande() {
    const verbatim = demandeSaisie.trim();
    if (verbatim === '' || verbatim.length > 4000) return;
    setDemandes((valeur) => [...valeur, verbatim]);
    setDemandeSaisie('');
  }

  function retirerDemande(index: number) {
    setDemandes((valeur) => valeur.filter((_, i) => i !== index));
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
      demandes: demandes.map((verbatim) => ({ verbatim })),
      plafondCentimes: plafondCentimes ?? undefined,
      plafondAutorisePar: plafondAutorisePar.trim() === '' ? undefined : plafondAutorisePar.trim(),
      restitutionPromiseLe: restitutionSaisie === '' ? undefined : new Date(restitutionSaisie).toISOString(),
      conducteurPresentNom: conducteurPresentNom.trim() === '' ? undefined : conducteurPresentNom.trim(),
      numeroCommandeInterne: numeroCommandeInterne.trim() === '' ? undefined : numeroCommandeInterne.trim(),
    };
  }

  function soumettre() {
    setErreursChamps({});
    setErreurGenerique(null);
    const entree = construireEntree();
    const resultat = schemaCreationOrdreReparation.safeParse(entree);
    if (!resultat.success) {
      const parChamp: ErreursChamps = {};
      let autre = false;
      for (const probleme of resultat.error.issues) {
        const chemin = probleme.path[0];
        if (chemin === 'kilometrageEntree') parChamp.kilometrageEntree = t('or:nouveau.champs.kmInvalide');
        else if (chemin === 'plafondCentimes') parChamp.plafondCentimes = t('or:nouveau.champs.plafondInvalide');
        else autre = true;
      }
      setErreursChamps(parChamp);
      if (autre) setErreurGenerique(t('validation:requis'));
      return;
    }
    creation.soumettre(resultat.data, { onSuccess: onCree });
  }

  const enCours = creation.enCours;
  const estErreurReseau = creation.erreur instanceof ErreurReseau;
  // Refus simple (§3.2/§3.4) contre CONFIRMATION_REQUISE (§4.4) : les deux sont mutuellement
  // exclusifs (`creation.erreur` est `null` tant qu'une confirmation reste à traiter, voir
  // `useCreationOrdreReparation`) — même distinction que `PanneauActionsOr`, le voisin naturel de
  // cet écran dans le module atelier.
  const confirmationsRequises = creation.confirmationsRequises;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3 rounded-md border p-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="texte-libelle text-muted-foreground">{t('or:nouveau.vehicule.titre')}</span>
          <span className="truncate texte-corps font-medium text-foreground">{vehicule.designation}</span>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onChangerVehicule} disabled={enCours}>
          {t('commun:actions.modifier')}
        </Button>
      </div>

      {creation.erreur ? (
        <Alert variant={estErreurReseau ? 'avertissement' : 'destructive'}>
          {estErreurReseau ? <WifiOff className="h-4 w-4" aria-hidden="true" /> : <AlertCircle className="h-4 w-4" aria-hidden="true" />}
          <AlertTitle>{t(estErreurReseau ? 'erreurs:reseau.titre' : 'or:nouveau.erreur.titre')}</AlertTitle>
          <AlertDescription>{messageErreur(creation.erreur, t)}</AlertDescription>
        </Alert>
      ) : null}

      {/* CONFIRMATION_REQUISE (§4.4) : la création reste possible, un accord explicite suffit —
       *  jamais un second clic silencieux sur « Ouvrir l'OR ». Prompt inline PUIS modal, comme
       *  `PanneauActionsOr` (le seul autre écran de ce module à traiter ce cas). */}
      {confirmationsRequises.length > 0 ? (
        <div role="alert" className="rounded-md border border-statut-attention/40 bg-statut-attention/10 p-3">
          <p className="texte-corps text-statut-attention">{creation.erreurActive ? messageErreur(creation.erreurActive, t) : ''}</p>
          <Button type="button" variant="outline" className="mt-2" onClick={() => setConfirmationOuverte(true)}>
            {t('commun:actions.continuerQuandMeme')}
          </Button>
        </div>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="or-nouveau-type">{t('or:nouveau.type.libelle')}</Label>
        <Select value={type} onValueChange={(valeur) => setType(valeur as TypeOrdreReparation)}>
          <SelectTrigger id="or-nouveau-type" aria-label={t('or:nouveau.type.libelle')}>
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
          <div role="group" aria-label={t('or:nouveau.champs.statutInitial')} className="inline-flex overflow-hidden rounded-md border">
            {(['ouvert', 'planifie'] as const satisfies readonly StatutInitialOrdreReparation[]).map((valeur) => (
              <button
                key={valeur}
                type="button"
                aria-pressed={statutInitial === valeur}
                onClick={() => setStatutInitial(valeur)}
                disabled={enCours}
                className={cn(
                  'h-11 px-4 texte-corps font-medium transition-colors',
                  statutInitial === valeur ? 'bg-primary text-primary-foreground' : 'bg-background text-foreground hover:bg-muted',
                )}
              >
                {t(`or:statuts.${valeur}`)}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <fieldset className="space-y-2 rounded-md border p-3">
        <legend className="px-1 texte-libelle font-medium text-foreground">{t('or:demandes.titre')}</legend>
        <p className="texte-libelle text-muted-foreground">{t('or:demandes.aide')}</p>
        {demandes.length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {demandes.map((verbatim, index) => (
              <li key={index} className="flex items-start justify-between gap-2 rounded-md bg-muted p-2 texte-corps">
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
          <Button type="button" variant="outline" onClick={ajouterDemande} disabled={enCours || demandeSaisie.trim() === ''}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t('or:demandes.ajouter')}
          </Button>
        </div>
      </fieldset>

      <ChampKilometrage
        valeur={kilometrageEntree}
        onChangeValeur={setKilometrageEntree}
        unite="km"
        label={t('or:actions.kilometrageEntree')}
        erreur={erreursChamps.kilometrageEntree}
        disabled={enCours}
      />

      <fieldset className="space-y-3 rounded-md border p-3">
        <legend className="px-1 texte-libelle font-medium text-foreground">{t('or:nouveau.champs.avance')}</legend>

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
          <Input
            id="or-nouveau-restitution"
            type="datetime-local"
            disabled={enCours}
            value={restitutionSaisie}
            onChange={(evenement) => setRestitutionSaisie(evenement.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="or-nouveau-po">
            {t('or:bandeau.numeroPo')}
            {client.poObligatoire ? ' *' : ''}
          </Label>
          <Input
            id="or-nouveau-po"
            maxLength={60}
            disabled={enCours}
            value={numeroCommandeInterne}
            onChange={(evenement) => setNumeroCommandeInterne(evenement.target.value)}
          />
          {client.poObligatoire ? <p className="texte-libelle text-muted-foreground">{t('or:refus.poManquant')}</p> : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="or-nouveau-conducteur">{t('or:nouveau.champs.conducteurPresentNom')}</Label>
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

      <AvertissementConfirmable
        ouvert={confirmationOuverte}
        onOuvertChange={setConfirmationOuverte}
        titre={t('or:nouveau.titre')}
        description={creation.erreurActive ? messageErreur(creation.erreurActive, t) : ''}
        libelleConfirmation={t('commun:actions.continuerQuandMeme')}
        onConfirmer={() => {
          setConfirmationOuverte(false);
          creation.confirmerEtResoumettre({ onSuccess: onCree });
        }}
        enCours={enCours}
      />
    </div>
  );
}
