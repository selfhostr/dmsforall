import { AlertCircle, CheckCircle2, WifiOff } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';

import {
  TYPES_ORDRE_REPARATION,
  type ReponseOrdreReparation,
  type TypeOrdreReparation,
} from '@dfa/shared';

import { ErreurReseau } from '@/api/erreurs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { DatetimeInput } from '@/components/ui/datetime-input';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ChampKilometrage } from '@/composants/comptoir/ChampKilometrage';
import { AvertissementConfirmable } from '@/composants/motifs/AvertissementConfirmable';
import { BandeauAlerteClient } from '@/composants/motifs/BandeauAlerteClient';
import { GabaritEcran } from '@/composants/motifs/GabaritEcran';
import { useOrdreDepuisPlaque } from '@/hooks/atelier/useOrdreDepuisPlaque';
import { useRechercheTypee } from '@/hooks/atelier/useRechercheTypee';
import { useClient } from '@/hooks/clients/useClient';
import { useVehiculesClient } from '@/hooks/clients/useVehiculesClient';
import { useParametresAtelier } from '@/hooks/parametres/useParametresAtelier';
import { useSiteCourant } from '@/hooks/site/ContexteSiteCourant';
import { useSiteImplicite } from '@/hooks/site/useSiteImplicite';
import { useLangue } from '@/hooks/useLangue';
import { useSession } from '@/hooks/useSession';
import { useContexteAtelier } from '@/hooks/vehicules/useContexteAtelier';
import { useDetentionsVehicule } from '@/hooks/vehicules/useDetentionsVehicule';
import { useVehicule } from '@/hooks/vehicules/useVehicule';
import { chemins } from '@/routes/chemins';

import { messageErreurMutation } from '../messages-erreur-mutation';
import {
  candidatDepuisRecherche,
  candidatDepuisVehicule,
  candidatEvident,
  type CandidatVehicule,
} from './candidats';
import { construirePlan, type ErreurSaisie, type ErreursSaisie } from './plan';
import { SectionClientRapide, type ClientChoisi } from './SectionClientRapide';
import { SectionVehiculePlaque } from './SectionVehiculePlaque';

const TYPE_PAR_DEFAUT: TypeOrdreReparation = 'reparation';

function Section({
  numero,
  titre,
  children,
}: {
  readonly numero: number;
  readonly titre: string;
  readonly children: ReactNode;
}) {
  const id = `or-rapide-section-${numero}`;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="texte-titre-section font-semibold text-foreground">
        <span className="text-muted-foreground">{numero}. </span>
        {titre}
      </h2>
      {children}
    </section>
  );
}

/**
 * Ouvrir un OR depuis une plaque, EN UN ÉCRAN (audit : 4 écrans et une URL à 3 paramètres avant).
 * Trois sections sur la même page, aucun dialogue : véhicule (plaque -> reconnu ou marque/modèle),
 * client (détenteur reconnu, retrouvé, ou nouveau avec nom + téléphone), ordre (type, demande,
 * kilométrage, restitution promise). Une validation crée, dans l'ordre, ce qui manque (client,
 * véhicule) puis l'OR ; si une étape échoue, ce qui est déjà créé est dit et conservé, le second
 * essai reprend où ça s'est arrêté (`useOrdreDepuisPlaque`).
 *
 * Arrive prérempli par l'URL : `plaque` (accueil, recherche), `vehiculeId` (fiche véhicule),
 * `clientId` (fiche client), `site`. L'ancien parcours (`/atelier/ordres-reparation/nouveau`)
 * reste disponible.
 */
export function EcranOrdreDepuisPlaque() {
  const { t } = useTranslation(['or', 'commun', 'erreurs', 'validation']);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const siteUrl = searchParams.get('site') ?? undefined;
  const plaqueUrl = searchParams.get('plaque') ?? '';
  const vehiculeIdUrl = searchParams.get('vehiculeId') ?? undefined;
  const clientIdUrl = searchParams.get('clientId') ?? undefined;

  const { langue } = useLangue();
  const { data: session } = useSession();
  const { estMonoSite, siteId: siteImplicite } = useSiteImplicite();
  const { preferenceSiteId } = useSiteCourant();
  const parametresAtelier = useParametresAtelier();
  const creation = useOrdreDepuisPlaque();

  // --- Site : jamais demandé à un garage mono-site.
  const [siteChoisi, setSiteChoisi] = useState(siteUrl ?? preferenceSiteId ?? '');
  const sitesActifs = (session?.sites ?? []).filter((site) => site.actif);
  const siteId = estMonoSite ? (siteImplicite ?? '') : siteChoisi;

  // --- Véhicule
  const [plaque, setPlaque] = useState(plaqueUrl);
  const [vehiculeChoisi, setVehiculeChoisi] = useState<CandidatVehicule | null>(null);
  const [vehiculeNouveau, setVehiculeNouveau] = useState(false);
  const [marque, setMarque] = useState('');
  const [modele, setModele] = useState('');
  const recherchePlaque = useRechercheTypee(plaque, 'vehicule', 2);
  const candidatsRecherche = useMemo(
    () => recherchePlaque.resultats.map(candidatDepuisRecherche),
    [recherchePlaque.resultats],
  );
  const vehiculePrechargeUrl = useVehicule(vehiculeIdUrl);
  const vehiculesClientUrl = useVehiculesClient(clientIdUrl);
  const candidatsClient = useMemo(
    () =>
      (vehiculesClientUrl.data?.pages.flatMap((p) => p.donnees) ?? []).map(candidatDepuisVehicule),
    [vehiculesClientUrl.data],
  );

  // Plaque tapée, recherche terminée, personne ne la porte : le véhicule est à créer — sans que
  // l'utilisateur ait à le demander.
  const aucunTrouve =
    recherchePlaque.active &&
    !recherchePlaque.enChargement &&
    !recherchePlaque.enErreur &&
    candidatsRecherche.length === 0;
  const vehiculeAcreer = vehiculeChoisi === null && (vehiculeNouveau || aucunTrouve);

  // Choix automatiques (une seule fois par véhicule) : ils ne doivent jamais se rejouer après un
  // « Changer » explicite de l'utilisateur.
  const dejaAutoChoisi = useRef<string | null>(null);
  const evident = recherchePlaque.active
    ? candidatEvident(candidatsRecherche, recherchePlaque.plaqueInterchangeable)
    : null;
  const vehiculePrecharge = vehiculePrechargeUrl.data;
  useEffect(() => {
    if (vehiculeChoisi !== null || vehiculeNouveau) return;
    const cible = vehiculePrecharge ? candidatDepuisVehicule(vehiculePrecharge) : evident;
    if (cible && dejaAutoChoisi.current !== cible.id) {
      dejaAutoChoisi.current = cible.id;
      setVehiculeChoisi(cible);
    }
  }, [vehiculeChoisi, vehiculeNouveau, vehiculePrecharge, evident]);

  // --- Client
  const clientUrl = useClient(clientIdUrl);
  const detentions = useDetentionsVehicule(vehiculeChoisi?.id);
  const detenteur = detentions.data?.find((d) => d.finLe === null)?.client;
  const [clientManuel, setClientManuel] = useState<ClientChoisi | null>(null);
  const [detenteurIgnore, setDetenteurIgnore] = useState(false);
  const [clientNouveau, setClientNouveau] = useState(false);
  const [nom, setNom] = useState('');
  const [telephone, setTelephone] = useState('');

  const clientDepuisUrl: ClientChoisi | null = clientUrl.data
    ? {
        id: clientUrl.data.id,
        nomAffiche: clientUrl.data.nomAffiche,
        telephone: clientUrl.data.telephone,
      }
    : null;
  const clientDepuisDetenteur: ClientChoisi | null =
    detenteur && !detenteurIgnore
      ? { id: detenteur.id, nomAffiche: detenteur.nomAffiche, telephone: null }
      : null;
  const client = clientManuel ?? clientDepuisUrl ?? clientDepuisDetenteur;
  const clientImposeParUrl = clientDepuisUrl !== null && clientManuel === null;
  const detenteurDuVehicule = client !== null && client === clientDepuisDetenteur;
  const ficheClient = useClient(client?.id);

  // --- Ordre
  const [type, setType] = useState<TypeOrdreReparation>(TYPE_PAR_DEFAUT);
  const [demande, setDemande] = useState('');
  const [kilometrage, setKilometrage] = useState<number | null>(null);
  const [restitution, setRestitution] = useState('');
  const [numeroCommande, setNumeroCommande] = useState('');
  const [erreurs, setErreurs] = useState<ErreursSaisie>({});
  const [confirmationRejetee, setConfirmationRejetee] = useState(false);

  const kilometrageObligatoire = parametresAtelier.data?.reception.kmEntreeObligatoire ?? false;
  const poObligatoire = ficheClient.data?.poObligatoire ?? false;

  const contexteAtelier = useContexteAtelier(vehiculeChoisi?.id);
  const orsOuverts = contexteAtelier.data?.ordresReparationOuverts ?? [];

  // Saisie figée pendant l'appel : le serveur crée tout ou rien, rien à verrouiller après un échec.
  const verrouille = creation.enCours;

  function texteErreur(code: ErreurSaisie | undefined): string | undefined {
    if (code === undefined) return undefined;
    return code === 'requis' ? t('validation:requis') : t('or:nouveau.rapide.invalide');
  }

  function soumettre() {
    setConfirmationRejetee(false);
    const resultat = construirePlan(
      {
        siteId,
        plaque,
        vehicule: vehiculeChoisi,
        vehiculeNouveau: vehiculeAcreer,
        marque,
        modele,
        client,
        clientNouveau,
        nom,
        telephone,
        langue,
        type,
        demande,
        kilometrage,
        restitution,
        numeroCommande,
      },
      { kilometrageObligatoire, poObligatoire },
    );
    if (!resultat.ok) {
      setErreurs(resultat.erreurs);
      return;
    }
    setErreurs({});
    void creation.lancer(resultat.plan, (or: ReponseOrdreReparation) => {
      navigate(chemins.atelier.ordresReparation.detail(or.id, siteId || undefined));
    });
  }

  const vehiculeAffiche =
    vehiculeChoisi !== null || vehiculeAcreer || recherchePlaque.active || plaque !== '';
  const echec = creation.erreur;
  const estErreurReseau = echec instanceof ErreurReseau;

  const deuxOrOuverts =
    creation.confirmationsRequises.includes('VEHICULE_DEUX_OR_OUVERTS') && orsOuverts.length > 0;

  return (
    <GabaritEcran titre={t('or:nouveau.rapide.titre')}>
      <form
        className="mx-auto flex w-full max-w-2xl flex-col gap-6"
        noValidate
        onSubmit={(evenement) => {
          evenement.preventDefault();
          soumettre();
        }}
      >
        <p className="texte-corps text-muted-foreground">{t('or:nouveau.rapide.intro')}</p>

        {clientUrl.isError ? (
          <Alert variant="avertissement">
            <AlertCircle className="h-4 w-4" aria-hidden="true" />
            <AlertDescription>{t('or:nouveau.rapide.clientIntrouvable')}</AlertDescription>
          </Alert>
        ) : null}

        <Section numero={1} titre={t('or:nouveau.rapide.vehicule.titre')}>
          <SectionVehiculePlaque
            plaque={plaque}
            onPlaqueChange={setPlaque}
            recherche={recherchePlaque}
            candidatsClient={candidatsClient}
            candidatsRecherche={candidatsRecherche}
            choisi={vehiculeChoisi}
            onChoisir={(candidat) => {
              setVehiculeChoisi(candidat);
              if (candidat === null) setDetenteurIgnore(false);
            }}
            nouveau={vehiculeNouveau}
            onNouveau={setVehiculeNouveau}
            marque={marque}
            modele={modele}
            onMarqueChange={setMarque}
            onModeleChange={setModele}
            erreurMarque={texteErreur(erreurs.marque)}
            erreurModele={texteErreur(erreurs.modele)}
            verrouille={verrouille}
            autoFocus={vehiculeIdUrl === undefined}
          />
          {erreurs.vehicule && !vehiculeAffiche ? (
            <p className="texte-corps text-destructive" role="alert">
              {t('or:nouveau.rapide.vehicule.requis')}
            </p>
          ) : null}
          {erreurs.vehicule && vehiculeAffiche ? (
            <p className="texte-corps text-destructive" role="alert">
              {t('or:nouveau.rapide.vehicule.choisir')}
            </p>
          ) : null}
        </Section>

        <Section numero={2} titre={t('or:nouveau.rapide.client.titre')}>
          {ficheClient.data ? (
            <BandeauAlerteClient
              bloque={ficheClient.data.statut === 'bloque'}
              alertes={ficheClient.data.notesAlerte.map((note) => ({
                id: note.id,
                texte: note.texte,
              }))}
            />
          ) : null}
          <SectionClientRapide
            choisi={client}
            onChoisir={(choix) => {
              setClientManuel(choix);
              if (choix === null) setDetenteurIgnore(true);
            }}
            detenteurDuVehicule={detenteurDuVehicule}
            nouveau={clientNouveau}
            onNouveau={setClientNouveau}
            nom={nom}
            telephone={telephone}
            onNomChange={setNom}
            onTelephoneChange={setTelephone}
            erreurNom={texteErreur(erreurs.nom)}
            erreurTelephone={texteErreur(erreurs.telephone)}
            verrouille={verrouille}
            imposeParUrl={clientImposeParUrl}
          />
          {erreurs.client ? (
            <p className="texte-corps text-destructive" role="alert">
              {t('or:nouveau.rapide.client.requis')}
            </p>
          ) : null}
        </Section>

        <Section numero={3} titre={t('or:nouveau.rapide.ordre.titre')}>
          {estMonoSite ? null : (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="or-rapide-site" requis>
                {t('or:nouveau.siteManquant.label')}
              </Label>
              <Select value={siteChoisi} onValueChange={setSiteChoisi}>
                <SelectTrigger
                  id="or-rapide-site"
                  aria-required="true"
                  aria-invalid={erreurs.site ? true : undefined}
                >
                  <SelectValue placeholder={t('or:nouveau.siteManquant.label')} />
                </SelectTrigger>
                <SelectContent>
                  {sitesActifs.map((site) => (
                    <SelectItem key={site.id} value={site.id}>
                      {site.nom}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {erreurs.site ? (
                <p className="texte-corps text-destructive">{texteErreur(erreurs.site)}</p>
              ) : null}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="or-rapide-demande">{t('or:nouveau.rapide.ordre.demande')}</Label>
            <Textarea
              id="or-rapide-demande"
              rows={3}
              maxLength={4000}
              value={demande}
              placeholder={t('or:nouveau.demandes.placeholder')}
              onChange={(evenement) => setDemande(evenement.target.value)}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="or-rapide-type" requis>
                {t('or:nouveau.type.libelle')}
              </Label>
              <Select
                value={type}
                onValueChange={(valeur) => setType(valeur as TypeOrdreReparation)}
              >
                <SelectTrigger id="or-rapide-type" aria-required="true">
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
            <ChampKilometrage
              valeur={kilometrage}
              onChangeValeur={setKilometrage}
              unite="km"
              label={t('or:actions.kilometrageEntree')}
              obligatoire={kilometrageObligatoire}
              erreur={texteErreur(erreurs.kilometrage)}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="or-rapide-restitution">{t('or:bandeau.restitutionPromise')}</Label>
              <DatetimeInput
                id="or-rapide-restitution"
                value={restitution}
                onChange={(valeurISO) => setRestitution(valeurISO ?? '')}
              />
            </div>
            {poObligatoire ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="or-rapide-po" requis>
                  {t('or:bandeau.numeroPo')}
                </Label>
                <Input
                  id="or-rapide-po"
                  maxLength={60}
                  value={numeroCommande}
                  aria-required="true"
                  aria-invalid={erreurs.numeroCommande ? true : undefined}
                  onChange={(evenement) => setNumeroCommande(evenement.target.value)}
                />
                {erreurs.numeroCommande ? (
                  <p className="texte-corps text-destructive">{t('or:refus.poManquant')}</p>
                ) : null}
              </div>
            ) : null}
          </div>
        </Section>

        {echec ? (
          <Alert variant={estErreurReseau ? 'avertissement' : 'destructive'} role="alert">
            {estErreurReseau ? (
              <WifiOff className="h-4 w-4" aria-hidden="true" />
            ) : (
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
            )}
            <AlertTitle>{t('or:nouveau.rapide.echec.titre')}</AlertTitle>
            <AlertDescription className="flex flex-col gap-1">
              <span>{messageErreurMutation(echec, t)}</span>
              <span>{t('or:nouveau.rapide.echec.reprise')}</span>
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button asChild variant="outline">
            <Link
              to={chemins.atelier.ordresReparation.nouveau(siteId || undefined, client?.id, true)}
            >
              {t('or:nouveau.rapide.ancienParcours')}
            </Link>
          </Button>
          <Button type="submit" disabled={creation.enCours}>
            {creation.enCours
              ? t('or:nouveau.actions.enCours')
              : echec
                ? t('or:nouveau.rapide.reessayer')
                : t('or:nouveau.actions.creer')}
          </Button>
        </div>
      </form>

      <AvertissementConfirmable
        ouvert={creation.confirmationsRequises.length > 0 && !confirmationRejetee}
        onOuvertChange={(ouvert) => {
          if (!ouvert) setConfirmationRejetee(true);
        }}
        titre={t('or:nouveau.rapide.titre')}
        description={
          deuxOrOuverts
            ? t('or:nouveau.confirmation.vehiculeDeuxOrOuverts', {
                numeros: orsOuverts.map((or) => or.numero).join(', '),
              })
            : creation.erreurActive
              ? messageErreurMutation(creation.erreurActive, t)
              : ''
        }
        libelleConfirmation={t('commun:actions.continuerQuandMeme')}
        onConfirmer={() =>
          creation.confirmerEtResoumettre({
            onSuccess: (or) =>
              navigate(chemins.atelier.ordresReparation.detail(or.id, siteId || undefined)),
          })
        }
        enCours={creation.enCours}
      >
        {deuxOrOuverts ? (
          <ul className="flex flex-col gap-1">
            {orsOuverts.map((orOuvert) => (
              <li key={orOuvert.id}>
                <Link
                  to={chemins.atelier.ordresReparation.detail(orOuvert.id, siteId || undefined)}
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
    </GabaritEcran>
  );
}
