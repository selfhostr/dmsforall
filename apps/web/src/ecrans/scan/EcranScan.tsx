import { AlertCircle, Camera, CheckCircle2, Loader2, ScanLine, WifiOff } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { GabaritEcran } from '@/composants/motifs/GabaritEcran';
import { useModeScanMobile } from '@/composants/layout/useModeScanMobile';
import { messageErreur, ErreurReseau } from '@/api/erreurs';
import {
  useEvenementsTempsReel,
  type EtatFluxTempsReel,
} from '@/hooks/temps-reel/useEvenementsTempsReel';
import { useSession } from '@/hooks/useSession';
import { chemins } from '@/routes/chemins';

import {
  appellerScanPermisCirculation,
  type ReponseScanPermisCirculation,
} from './contrat-ocr.temporaire';
import { FormulairePermisScanne, type ResultatCreationScan } from './FormulairePermisScanne';
import { ErreurReductionImage, reduireImagePourEnvoi } from './reduireImage';

/**
 * MACHINE À ÉTATS DE L'ÉCRAN — chaque étape du parcours (comptoir : photographier -> vérifier ->
 * valider) est un état DISTINCT, jamais une combinaison de booléens indépendants (`enChargement` +
 * `erreur` + `donnees` pourrait décrire des combinaisons impossibles, ex. chargement ET données à
 * la fois). Voir CONTRIBUTING.md, priorité de test « machines à états ».
 */
type EtapeScan =
  | { readonly phase: 'capture' }
  | { readonly phase: 'preparation' }
  | { readonly phase: 'analyse'; readonly controleur: AbortController }
  | { readonly phase: 'formulaire'; readonly reponse: ReponseScanPermisCirculation }
  | { readonly phase: 'resultat'; readonly resultat: ResultatCreationScan }
  | {
      readonly phase: 'erreur';
      readonly categorie: 'image' | 'reseau' | 'serveur';
      readonly message: string;
    };

/**
 * ÉCRAN SCAN — point d'entrée unique du chantier « scanner de permis de circulation ». Photographie
 * (capture native, jamais un flux vidéo maison), réduction/conversion côté client
 * (`reduireImage.ts`, gère aussi le HEIC des iPhone), appel OCR (`contrat-ocr.temporaire.ts` —
 * contrat TEMPORAIRE, endpoint encore en construction par un autre agent, en parallèle),
 * vérification/correction (`FormulairePermisScanne.tsx`), puis création.
 *
 * TROIS ISSUES, jamais confondues (décision de @laupernoe) : rien n'existe (les deux sont créés), le
 * client existe déjà seul (le véhicule est créé et rattaché), les deux existent déjà (rien à
 * créer, on le dit clairement). La distinction est calculée ici, une seule fois
 * (`correspondances` de la réponse OCR), puis transmise en props — jamais recalculée plus bas.
 *
 * JAMAIS DE FAUX SUCCÈS (issue #63) : la photo n'est envoyée qu'une fois réduite avec succès,
 * l'état `resultat` n'est atteint qu'après une confirmation serveur réelle (ou l'absence
 * confirmée de toute création nécessaire), et toute panne — image illisible, réseau, serveur — a
 * son propre état d'erreur explicite, jamais un écran qui prétend avoir réussi.
 */
export function EcranScan() {
  const { t } = useTranslation(['scan', 'commun', 'erreurs']);
  const { data: session } = useSession();
  const modeScan = useModeScanMobile(session?.utilisateur.role);
  const [searchParams] = useSearchParams();
  const site = searchParams.get('site') ?? undefined;

  const [etape, setEtape] = useState<EtapeScan>({ phase: 'capture' });
  const inputRef = useRef<HTMLInputElement>(null);

  // Abonnement au canal temps réel OUVERT DÈS LE MONTAGE de l'écran, AVANT même la prise de
  // photo — arbitrage du coordinateur : supprime la fenêtre de course plutôt que de la réduire.
  // Auparavant abonné seulement dans `PanneauRienACreer`, monté APRÈS la réponse OCR : un
  // événement émis pendant ce round-trip (l'agent OCR détecte les deux correspondances et émet
  // au même moment qu'il répond à CETTE requête) pouvait arriver avant que quiconque n'écoute —
  // un flux SSE ne rejoue pas l'historique pour un nouvel abonné. Ici, le flux est établi bien
  // avant l'envoi de la photo : l'événement ne peut plus jamais devancer l'abonnement.
  //
  // `clientIdsConfirmes` mémorise TOUS les `clientId` vus depuis le montage, pas seulement le
  // dernier — un seul écran de scan peut en théorie enchaîner plusieurs scans (« Scanner un
  // autre permis ») sans démonter le flux, chacun avec son propre client.
  const [clientIdsConfirmes, setClientIdsConfirmes] = useState<ReadonlySet<string>>(new Set());
  const etatCanalTempsReel = useEvenementsTempsReel((evenement) => {
    if (evenement.type !== 'vehicule.correspondance_scan_permis') return;
    setClientIdsConfirmes((precedent) => {
      if (precedent.has(evenement.donnees.clientId)) return precedent;
      return new Set(precedent).add(evenement.donnees.clientId);
    });
  });

  function recommencer() {
    setEtape({ phase: 'capture' });
  }

  async function traiterFichier(fichier: File) {
    setEtape({ phase: 'preparation' });

    let image: Awaited<ReturnType<typeof reduireImagePourEnvoi>>;
    try {
      image = await reduireImagePourEnvoi(fichier);
    } catch (cause) {
      const motif = cause instanceof ErreurReductionImage ? cause.motif : 'echec_lecture';
      setEtape({
        phase: 'erreur',
        categorie: 'image',
        message: t(
          motif === 'heic_non_pris_en_charge'
            ? 'scan:erreurs.heicNonPrisEnCharge'
            : 'scan:erreurs.photoIllisible',
        ),
      });
      return;
    }

    const controleur = new AbortController();
    setEtape({ phase: 'analyse', controleur });
    try {
      const reponse = await appellerScanPermisCirculation(image.blob, controleur.signal);
      setEtape({ phase: 'formulaire', reponse });
    } catch (cause) {
      if (controleur.signal.aborted) return; // annulation explicite — déjà revenu à 'capture'
      setEtape({
        phase: 'erreur',
        categorie: cause instanceof ErreurReseau ? 'reseau' : 'serveur',
        message: messageErreur(cause, t),
      });
    }
  }

  function annulerAnalyse() {
    if (etape.phase === 'analyse') etape.controleur.abort();
    setEtape({ phase: 'capture' });
  }

  return (
    <GabaritEcran titre={t('scan:titre')} sousTitre={t('scan:sousTitre')}>
      <div className="flex flex-col gap-6">
        {/* Échappatoire (voir `useModeScanMobile.ts`) — visible à CHAQUE étape du parcours, pas
            seulement à l'accueil : un utilisateur mal classé « mobile » ne doit jamais chercher
            comment sortir. Absente hors mode restreint (rien à quitter). */}
        {modeScan.actif ? (
          <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/40 p-3">
            <p className="texte-libelle text-muted-foreground">{t('scan:echappement.message')}</p>
            <Button type="button" variant="outline" size="sm" onClick={modeScan.quitter} asChild>
              <Link to={chemins.tableauBord(site)}>{t('scan:echappement.action')}</Link>
            </Button>
          </div>
        ) : null}

        {etape.phase === 'capture' ? (
          <div className="mx-auto flex w-full max-w-md flex-col items-center gap-6 text-center">
            <div className="flex h-40 w-full items-center justify-center rounded-lg border-2 border-dashed border-input bg-muted/30">
              <ScanLine className="h-16 w-16 text-muted-foreground" aria-hidden="true" />
            </div>
            <div className="space-y-2">
              <p className="texte-corps font-medium">{t('scan:capture.consigneTitre')}</p>
              <ul className="space-y-1 texte-libelle text-muted-foreground">
                <li>{t('scan:capture.consignePlat')}</li>
                <li>{t('scan:capture.consigneLumiere')}</li>
                <li>{t('scan:capture.consigneCadre')}</li>
              </ul>
            </div>
            {/* Capture native uniquement (`capture="environment"`) — pas de flux vidéo maison,
                consigne explicite du brief. `accept="image/*"` reste large (pas `image/jpeg` seul)
                pour laisser l'appareil choisir son propre format natif ; `reduireImage.ts` gère la
                conversion, HEIC compris, avant l'envoi. */}
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              aria-label={t('scan:capture.action')}
              onChange={(evenement) => {
                const fichier = evenement.target.files?.[0];
                evenement.target.value = '';
                if (fichier) void traiterFichier(fichier);
              }}
            />
            {/* h-14 (56 px), bien au-dessus du plancher tactile de 44 px du produit — action
                PRIMAIRE unique de cette étape, pensée pour un pouce, une seule main. */}
            <Button
              type="button"
              className="h-14 w-full gap-2 text-base"
              onClick={() => inputRef.current?.click()}
            >
              <Camera className="h-5 w-5" aria-hidden="true" />
              {t('scan:capture.action')}
            </Button>
          </div>
        ) : null}

        {etape.phase === 'preparation' ? (
          <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 py-10 text-center">
            <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" aria-hidden="true" />
            <p role="status" className="texte-corps font-medium">
              {t('scan:preparation.enCours')}
            </p>
          </div>
        ) : null}

        {etape.phase === 'analyse' ? (
          <div className="mx-auto flex w-full max-w-md flex-col items-center gap-6 py-10 text-center">
            <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" aria-hidden="true" />
            <p role="status" className="texte-corps font-medium">
              {t('scan:analyse.enCours')}
            </p>
            <Button type="button" variant="outline" onClick={annulerAnalyse}>
              {t('commun:actions.annuler')}
            </Button>
          </div>
        ) : null}

        {etape.phase === 'erreur' ? (
          <div className="mx-auto flex w-full max-w-md flex-col gap-4">
            <Alert variant={etape.categorie === 'reseau' ? 'avertissement' : 'destructive'}>
              {etape.categorie === 'reseau' ? (
                <WifiOff className="h-4 w-4" aria-hidden="true" />
              ) : (
                <AlertCircle className="h-4 w-4" aria-hidden="true" />
              )}
              <AlertTitle>{t('scan:erreurs.titre')}</AlertTitle>
              <AlertDescription>{etape.message}</AlertDescription>
            </Alert>
            <Button type="button" onClick={recommencer}>
              {t('scan:actions.reessayer')}
            </Button>
          </div>
        ) : null}

        {etape.phase === 'formulaire' ? (
          <PanneauFormulaireOuResultat
            reponse={etape.reponse}
            etatCanalTempsReel={etatCanalTempsReel}
            clientIdsConfirmes={clientIdsConfirmes}
            onSucces={(resultat) => setEtape({ phase: 'resultat', resultat })}
            onAnnuler={recommencer}
          />
        ) : null}

        {etape.phase === 'resultat' ? (
          <PanneauResultat resultat={etape.resultat} site={site} onRecommencer={recommencer} />
        ) : null}
      </div>
    </GabaritEcran>
  );
}

interface PropsPanneauFormulaireOuResultat {
  readonly reponse: ReponseScanPermisCirculation;
  readonly etatCanalTempsReel: EtatFluxTempsReel;
  readonly clientIdsConfirmes: ReadonlySet<string>;
  readonly onSucces: (resultat: ResultatCreationScan) => void;
  readonly onAnnuler: () => void;
}

/**
 * Calcule l'issue UNE SEULE FOIS depuis `correspondances` (voir la doc de tête d'`EcranScan`) et
 * choisit le bon rendu : les deux existent déjà -> rien à soumettre, juste le dire (`PanneauRienACreer`) ;
 * sinon -> le formulaire de vérification (`FormulairePermisScanne`), qui sait lui-même s'il doit
 * créer le client ou réutiliser celui déjà trouvé (`clientExistant`).
 */
function PanneauFormulaireOuResultat({
  reponse,
  etatCanalTempsReel,
  clientIdsConfirmes,
  onSucces,
  onAnnuler,
}: PropsPanneauFormulaireOuResultat) {
  const { correspondances, donnees } = reponse;

  if (correspondances.client && correspondances.vehicule) {
    return (
      <PanneauRienACreer
        client={correspondances.client}
        vehicule={correspondances.vehicule}
        etatCanalTempsReel={etatCanalTempsReel}
        confirme={clientIdsConfirmes.has(correspondances.client.id)}
        onTermine={onAnnuler}
      />
    );
  }

  return (
    <FormulairePermisScanne
      donnees={donnees}
      clientExistant={correspondances.client}
      onSucces={onSucces}
      onAnnuler={onAnnuler}
    />
  );
}

interface PropsPanneauRienACreer {
  readonly client: { readonly id: string; readonly nomAffiche: string };
  readonly vehicule: { readonly id: string; readonly libelle: string };
  readonly etatCanalTempsReel: EtatFluxTempsReel;
  /** `true` dès que l'événement matching a été observé sur le canal — voir `EcranScan`, qui tient
   *  ce registre depuis son propre montage (abonnement ouvert AVANT la photo, voir sa doc). */
  readonly confirme: boolean;
  readonly onTermine: () => void;
}

/**
 * Troisième issue : les deux existent déjà. RIEN n'est envoyé au serveur (aucun `POST`) — le dire
 * clairement plutôt que de laisser croire à une création, avec un accès direct aux deux fiches
 * concernées.
 *
 * « Le poste fixe en est averti » (brief) — câblé via le canal temps réel
 * (`hooks/temps-reel/useEvenementsTempsReel`, livré en parallèle). L'ÉMISSION est entièrement
 * SERVEUR (l'agent OCR, en réponse à `POST /scan/permis-circulation` quand `correspondances`
 * porte les deux) : ce panneau ne fait qu'AFFICHER un état déjà observé par `EcranScan` — voir sa
 * doc de tête pour l'abonnement lui-même, ouvert dès le montage de l'écran, avant la photo, pour
 * qu'un événement émis pendant le round-trip OCR ne puisse plus jamais devancer l'abonnement.
 *
 * JAMAIS DE FAUX SUCCÈS (même doctrine que le reste de l'écran) : ce panneau n'affiche « le poste
 * fixe a été informé » que si `confirme` (prop) l'atteste — jamais une promesse non vérifiée.
 * Trois états honnêtes, jamais un seul « c'est fait » supposé :
 *  - en attente (canal connecté ou en cours de connexion, rien reçu encore) ;
 *  - confirmé (l'événement matching a été observé) ;
 *  - indisponible (canal en reconnexion/fermé) — DÉGRADATION SILENCIEUSE, jamais un blocage : le
 *    panneau (liens vers les fiches, bouton « Scanner un autre ») reste pleinement utilisable,
 *    conformément à la doctrine du hook (« notification best-effort », voir sa doc de tête).
 *
 * REMISE EN PERSPECTIVE (arbitrage du coordinateur) : le destinataire RÉEL de cette notification
 * est le POSTE FIXE, pas ce téléphone — cet indicateur est un confort, pas la fonctionnalité. S'il
 * reste un cas résiduel où l'état affiché demeure « en attente » alors que tout s'est bien passé
 * (rôle de ce compte non inclus dans le filtrage serveur par rôle, par exemple), ce n'est PAS un
 * défaut à corriger ici tant que rien n'affirme le contraire et que le panneau reste utilisable —
 * ce qui est déjà le cas. Volontairement pas d'investissement supplémentaire au-delà de
 * l'exactitude déjà obtenue en supprimant la fenêtre de course.
 */
function PanneauRienACreer({
  client,
  vehicule,
  etatCanalTempsReel,
  confirme,
  onTermine,
}: PropsPanneauRienACreer) {
  const { t } = useTranslation('scan');
  const canalIndisponible = etatCanalTempsReel === 'reconnexion' || etatCanalTempsReel === 'ferme';

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4">
      <Alert>
        <AlertTitle>{t('scan:rienACreer.titre')}</AlertTitle>
        <AlertDescription>{t('scan:rienACreer.description')}</AlertDescription>
      </Alert>
      <div className="flex flex-col gap-2 rounded-md border p-3">
        <Link to={chemins.clients.detail(client.id)} className="texte-corps font-medium underline">
          {client.nomAffiche}
        </Link>
        <Link
          to={chemins.vehicules.detail(vehicule.id)}
          className="texte-corps font-medium underline"
        >
          {vehicule.libelle}
        </Link>
      </div>
      {/* État de la notification du poste fixe — JAMAIS bloquant (`role="status"`, pas d'`Alert`
          destructive même quand le canal est indisponible), toujours sous les liens de fiche qui
          restent l'action utile même sans confirmation. */}
      <p role="status" className="flex items-center gap-2 texte-libelle text-muted-foreground">
        {confirme ? (
          <>
            <CheckCircle2 className="h-4 w-4 shrink-0 text-foreground" aria-hidden="true" />
            {t('scan:rienACreer.posteFixe.confirme')}
          </>
        ) : canalIndisponible ? (
          <>
            <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
            {t('scan:rienACreer.posteFixe.indisponible')}
          </>
        ) : (
          <>
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
            {t('scan:rienACreer.posteFixe.enAttente')}
          </>
        )}
      </p>
      <Button type="button" variant="outline" onClick={onTermine}>
        {t('scan:actions.scannerUnAutre')}
      </Button>
    </div>
  );
}

interface PropsPanneauResultat {
  readonly resultat: ResultatCreationScan;
  readonly site: string | undefined;
  readonly onRecommencer: () => void;
}

function PanneauResultat({ resultat, site, onRecommencer }: PropsPanneauResultat) {
  const { t } = useTranslation('scan');
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4">
      <Alert>
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
        <AlertTitle>{t('scan:resultat.titre')}</AlertTitle>
        <AlertDescription>
          {t(resultat.client.cree ? 'scan:resultat.clientCree' : 'scan:resultat.clientRattache', {
            nom: resultat.client.nomAffiche,
          })}
        </AlertDescription>
      </Alert>
      <div className="flex flex-col gap-2 rounded-md border p-3">
        <Link
          to={chemins.clients.detail(resultat.client.id, site)}
          className="texte-corps font-medium underline"
        >
          {resultat.client.nomAffiche}
        </Link>
        <Link
          to={chemins.vehicules.detail(resultat.vehicule.id, site)}
          className="texte-corps font-medium underline"
        >
          {resultat.vehicule.libelle}
        </Link>
      </div>
      <Button type="button" onClick={onRecommencer}>
        {t('scan:actions.scannerUnAutre')}
      </Button>
    </div>
  );
}
