import { AlertCircle, Camera, CheckCircle2, IdCard, Loader2, LogOut, WifiOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useSearchParams } from 'react-router';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { GabaritEcran } from '@/composants/motifs/GabaritEcran';
import { useModeScanMobile } from '@/composants/layout/useModeScanMobile';
import { messageErreur, ErreurApi, ErreurReseau } from '@/api/erreurs';
import {
  useEvenementsTempsReel,
  type EtatFluxTempsReel,
} from '@/hooks/temps-reel/useEvenementsTempsReel';
import { useSession } from '@/hooks/useSession';
import { chemins } from '@/routes/chemins';

import { analyserQualitePhoto, type MotifRefusPhoto } from './analyserQualitePhoto';
import { CaptureLiveCadrage } from './CaptureLiveCadrage';
import {
  appellerScanPermisCirculation,
  type ReponseScanPermisCirculation,
} from './contrat-ocr.temporaire';
import { estCaptureLiveDisponible } from './disponibiliteCaptureLive';
import type { FractionsCadre, RectanglePixels } from './geometrieCadre';
import { FormulairePermisScanne, type ResultatCreationScan } from './FormulairePermisScanne';
import { PanneauConfirmationCadrage } from './PanneauConfirmationCadrage';
import { PanneauRefusPhoto } from './PanneauRefusPhoto';
import { ErreurReductionImage, reduireImagePourEnvoi } from './reduireImage';

/**
 * MACHINE À ÉTATS DE L'ÉCRAN — chaque étape du parcours (comptoir : photographier -> vérifier ->
 * valider) est un état DISTINCT, jamais une combinaison de booléens indépendants (`enChargement` +
 * `erreur` + `donnees` pourrait décrire des combinaisons impossibles, ex. chargement ET données à
 * la fois). Voir CONTRIBUTING.md, priorité de test « machines à états ».
 */
type EtapeScan =
  | { readonly phase: 'capture' }
  | { readonly phase: 'controleQualite' }
  | {
      readonly phase: 'refus';
      readonly fichier: File;
      readonly urlApercu: string;
      readonly zone: RectanglePixels;
      readonly fractions: FractionsCadre;
      readonly motif: MotifRefusPhoto;
    }
  | {
      readonly phase: 'cadrage';
      readonly fichier: File;
      readonly urlApercu: string;
      readonly zone: RectanglePixels;
      readonly fractions: FractionsCadre;
    }
  | { readonly phase: 'preparation' }
  | { readonly phase: 'analyse'; readonly controleur: AbortController }
  | { readonly phase: 'formulaire'; readonly reponse: ReponseScanPermisCirculation }
  | { readonly phase: 'resultat'; readonly resultat: ResultatCreationScan }
  | {
      readonly phase: 'erreur';
      readonly categorie: 'image' | 'reseau' | 'serveur';
      readonly message: string;
      /** `true` UNIQUEMENT quand la cause exacte est une session expirée côté serveur
       *  (`AUTH_SESSION_EXPIREE`, voir `envoyerPourAnalyse`) — remplace alors l'action « Reprendre
       *  une photo » (qui échouerait de nouveau à l'identique, la session étant partie) par un
       *  lien explicite vers la connexion. Voir la doc de tête, § SESSION. */
      readonly sessionExpiree?: boolean;
    };

/**
 * ÉCRAN SCAN — point d'entrée unique du chantier « scanner de permis de circulation ». Photographie
 * — capture native par défaut, flux vidéo en direct (`CaptureLiveCadrage.tsx`) UNIQUEMENT sur
 * contexte sécurisé (`liveDisponible`, voir `disponibiliteCaptureLive.ts` — au 18.08.2026 le site
 * ne sert pas en HTTPS, donc toujours la capture native en pratique, sans que rien n'ait besoin de
 * changer ici le jour où ça change) — puis CADRAGE AUTOMATIQUE avec CONTRÔLE QUALITÉ avant envoi
 * (`analyserQualitePhoto.ts` — résolution, netteté, présence d'un document dans le cadre ; voir sa
 * doc de tête pour ce qui est honnêtement mesurable et ce qui ne l'est pas), recadrage +
 * réduction/conversion côté client (`reduireImage.ts`, gère aussi le HEIC des iPhone), appel OCR
 * (`contrat-ocr.temporaire.ts` — contrat TEMPORAIRE, endpoint encore en construction par un autre
 * lot, en parallèle), vérification/correction (`FormulairePermisScanne.tsx`), puis création.
 *
 * L'ÉTAPE « capture » NE MONTRE PLUS DE CADRE (retiré lors du chantier ergonomie du 16.08.2026,
 * retour produit direct : « un grand rectangle, on comprend rien »). Cause profonde identifiée : la
 * prise de vue passe par l'appareil photo NATIF du téléphone (plein écran, hors de notre contrôle)
 * — un cadre affiché AVANT de déclencher n'est donc JAMAIS visible pendant la capture, il ne guidait
 * personne. À la place, cette étape dit l'OBJECTIF avant tout (pictogramme `IdCard` + un titre qui
 * explique le bénéfice concret — la fiche se remplit toute seule — plutôt qu'une consigne
 * technique), puis un seul geste évident (`scan:capture.action`, bouton `h-14` unique de l'écran).
 * Le cadre (`CadrePermis.tsx`, proportions du RECTO du permis suisse — décision de conception, jamais le
 * verso) réapparaît seulement là où il a un sens : SUPERPOSÉ SUR LA PHOTO déjà prise, en phase
 * `refus` OU `cadrage`, pour montrer exactement la zone jugée/retenue.
 *
 * CADRAGE AUTOMATIQUE (demande produit, 18.08.2026) — `analyserQualitePhoto.ts` tente désormais une
 * vraie DÉTECTION DES BORDS du document (`detecterBordsDocument.ts`, contraste avec le fond ; voir
 * sa doc de tête pour la méthode et ses limites, notamment l'absence de correction de perspective) ;
 * repli sur le cadre géométrique fixe (`geometrieCadre.ts`, calcul déterministe, aucune lecture du
 * contenu) quand la détection n'est pas assez confiante. UNE DÉTECTION PEUT SE TROMPER — jamais un
 * recadrage détecté n'est envoyé sans confirmation : phase `cadrage`
 * (`PanneauConfirmationCadrage.tsx`) avant tout appel réseau, avec un recours EXPLICITE pour
 * repartir de la photo entière (« annulabilité » exigée côté produit). Le cadre de REPLI, lui, reste
 * envoyé directement (comportement inchangé d'avant ce chantier : sa marge de 14 % ne coupe jamais
 * le document, aucun recours n'est nécessaire).
 *
 * CONTRÔLE QUALITÉ AVEC POSSIBILITÉ DE FORCER (décision de conception), jamais bloquant. Une photo
 * manifestement mauvaise (résolution insuffisante, document trop petit dans le cadre, floue)
 * déclenche un REFUS EXPLICITE ET RÉESSAYABLE (`PanneauRefusPhoto.tsx`, phase `refus`) plutôt qu'un
 * envoi silencieusement dégradé ; « Envoyer quand même » reste toujours atteignable depuis ce refus,
 * avec un avertissement explicite que la lecture risque d'être partielle — jamais un blocage total.
 *
 * TROIS ISSUES, jamais confondues (décision de conception) : rien n'existe (les deux sont créés), le
 * client existe déjà seul (le véhicule est créé et rattaché), les deux existent déjà (rien à
 * créer, on le dit clairement). La distinction est calculée ici, une seule fois
 * (`correspondances` de la réponse OCR), puis transmise en props — jamais recalculée plus bas.
 *
 * JAMAIS DE FAUX SUCCÈS (issue #63) : la photo n'est envoyée qu'une fois réduite avec succès,
 * l'état `resultat` n'est atteint qu'après une confirmation serveur réelle (ou l'absence
 * confirmée de toute création nécessaire), et toute panne — image illisible, réseau, serveur — a
 * son propre état d'erreur explicite, jamais un écran qui prétend avoir réussi.
 *
 * SESSION — défaut constaté sur DEUX écrans indépendants (celui-ci et la borne d'atelier, issue
 * #159, `EcranBornePointage.tsx` — MÊME raisonnement, non répété en détail ici) : `useSession()`
 * était appelé sans jamais lire `isPending`/`isError`, donc trois situations très différentes
 * (plus de session, service injoignable, vérification en cours) retombaient sur le même rendu, ou
 * pire, aucun. `RouteProtegee` (`routes/RouteProtegee.tsx`) garde déjà la route `/scan` — mais cet
 * écran porte sa PROPRE requête `useSession()` (nécessaire à son propre squelette anti-flash), ce
 * qui laisse une fenêtre réelle ouverte : la session peut s'éteindre PENDANT que cet écran est
 * déjà monté (déconnexion, TTL dépassé), un instant avant que `RouteProtegee` ne démonte l'arbre.
 *
 * Trois états, jamais confondus : en cours de vérification -> squelette, jamais l'écran de
 * capture affiché prématurément ; `session === null` (DONNÉE CONNUE, 401 propre confirmé par le
 * serveur, jamais une panne) -> plus de session ; service injoignable (`isError`, PAS une absence
 * de session) -> message actionnable, réessai possible.
 *
 * CE QUI DIFFÈRE DE LA BORNE, délibérément : la borne est un poste PARTAGÉ sans travail personnel
 * en cours (le pointage vit côté serveur, reprenable) — un redirect immédiat vers `/login` n'y
 * perd donc rien. Ici, un garagiste peut tenir en main une photo tout juste prise, un cadrage à
 * confirmer, ou un formulaire déjà corrigé à la main : un redirect immédiat FERAIT DISPARAÎTRE ce
 * travail SANS AUCUN AVERTISSEMENT. Donc : `session === null` À L'ÉTAPE `capture` (rien
 * d'engagé) -> redirect direct, identique à la borne ; `session === null` À TOUTE AUTRE ÉTAPE ->
 * l'écran continue de s'afficher NORMALEMENT (le travail en cours reste visible), avec une
 * bannière explicite non bloquante en tête de page — le garagiste choisit LUI-MÊME le moment de se
 * reconnecter, jamais un silence. Même logique pour `isError` : bloquant seulement à l'étape
 * `capture` (rien à perdre) ; au-delà, ce contrôle redevient un simple confort, comme le canal
 * temps réel (voir `PanneauRienACreer`) — jamais un blocage d'un parcours déjà engagé, dont les
 * propres appels réseau (OCR, création) ont leur gestion d'erreur dédiée (voir juste en dessous).
 *
 * SESSION PERDUE PENDANT L'APPEL OCR LUI-MÊME (entre la prise de la photo et le retour du
 * serveur, `envoyerPourAnalyse`) : un cas DISTINCT du précédent — ici c'est l'appel réseau du scan
 * qui échoue en 401 `AUTH_SESSION_EXPIREE`, pas la requête `useSession()` de cet écran. Déjà non
 * silencieux avant ce correctif (le message précis « Votre session a expiré » s'affichait déjà,
 * via `messageErreur`/`erreurs:codes.AUTH_SESSION_EXPIREE`) — seule l'action proposée était fausse
 * (« Reprendre une photo » aurait échoué à l'identique). `sessionExpiree` sur la phase `erreur`
 * corrige CETTE action, rien d'autre.
 */
export function EcranScan() {
  const { t } = useTranslation(['scan', 'commun', 'erreurs']);
  const {
    isPending: sessionEnAttente,
    isError: sessionEnErreur,
    data: session,
    refetch: rafraichirSession,
  } = useSession();
  const modeScan = useModeScanMobile(session?.actions);
  const [searchParams] = useSearchParams();
  const site = searchParams.get('site') ?? undefined;

  const [etape, setEtape] = useState<EtapeScan>({ phase: 'capture' });
  const inputRef = useRef<HTMLInputElement>(null);

  // Bascule LIVE <-> NATIVE — voir `disponibiliteCaptureLive.ts` : vérifié une fois au montage
  // (contexte sécurisé ou non ne change pas pendant la vie de l'écran), et peut redescendre à
  // `false` en cours de route si `CaptureLiveCadrage` échoue à obtenir un flux caméra (permission
  // refusée, caméra absente/occupée — voir `onIndisponible` plus bas) : JAMAIS l'inverse, une fois
  // replié sur la capture native on n'y retente pas la caméra dans la même visite de l'écran.
  const [liveDisponible, setLiveDisponible] = useState(estCaptureLiveDisponible);

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

  // L'aperçu affiché en phase `refus` OU `cadrage` (`PanneauRefusPhoto`/`PanneauConfirmationCadrage`)
  // garde une URL d'objet vivante tant que l'utilisateur regarde ce panneau — jamais plus longtemps :
  // ce nettoyage se déclenche à CHAQUE changement de `etape` (donc dès qu'on QUITTE l'une de ces
  // deux phases, quel que soit le chemin — reprendre, envoyer quand même/continuer/photo entière, ou
  // même une navigation qui démonte l'écran) et ne fait rien les autres fois (aucune URL créée hors
  // de ces phases). Centraliser ici plutôt que dans chaque gestionnaire de sortie : une seule règle,
  // jamais oubliable à un futur point de sortie supplémentaire.
  useEffect(() => {
    if (etape.phase !== 'refus' && etape.phase !== 'cadrage') return;
    const url = etape.urlApercu;
    return () => URL.revokeObjectURL(url);
  }, [etape]);

  /**
   * ÉTAPE 1/2 du traitement d'une photo : contrôle qualité AVANT tout envoi réseau — jamais un
   * décodage-réduction direct comme avant ce chantier. `analyserQualitePhoto` décode `fichier` une
   * première fois (les erreurs de décodage — HEIC illisible, fichier corrompu — sont TRAITÉES ICI,
   * identiquement à avant : même message, même phase `erreur`) puis mesure ce qu'elle peut mesurer
   * honnêtement sur la zone retenue (détectée automatiquement ou cadre de repli — voir sa doc de
   * tête). Trois issues, jamais confondues :
   *  - refusée (qualité insuffisante) -> phase `refus`, l'utilisateur décide (reprendre ou forcer) ;
   *  - acceptée avec un cadrage DÉTECTÉ (`cadrageDetecte`) -> phase `cadrage`, confirmation
   *    obligatoire AVANT tout envoi (`PanneauConfirmationCadrage.tsx` — une détection peut se
   *    tromper, brief produit explicite sur l'« annulabilité ») ;
   *  - acceptée avec le cadre de REPLI géométrique fixe -> directement `envoyerPourAnalyse`, AUCUNE
   *    étape intermédiaire (comportement inchangé d'avant ce chantier : ce cadre est généreux par
   *    construction, jamais besoin d'un recours).
   */
  async function traiterFichier(fichier: File) {
    setEtape({ phase: 'controleQualite' });

    let resultat: Awaited<ReturnType<typeof analyserQualitePhoto>>;
    try {
      resultat = await analyserQualitePhoto(fichier);
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

    if (resultat.motifRefus) {
      setEtape({
        phase: 'refus',
        fichier,
        urlApercu: URL.createObjectURL(fichier),
        zone: resultat.zone,
        fractions: resultat.fractions,
        motif: resultat.motifRefus,
      });
      return;
    }

    if (resultat.cadrageDetecte) {
      setEtape({
        phase: 'cadrage',
        fichier,
        urlApercu: URL.createObjectURL(fichier),
        zone: resultat.zone,
        fractions: resultat.fractions,
      });
      return;
    }

    void envoyerPourAnalyse(fichier, resultat.zone);
  }

  /**
   * ÉTAPE 2/2 : recadrage + réduction (`reduireImagePourEnvoi`, avec `zone` — voir sa doc de tête)
   * puis appel OCR. Reprend exactement la logique d'avant ce chantier, désormais atteinte depuis
   * TROIS chemins (`traiterFichier` quand le contrôle qualité accepte sans détection, `confirmerCadrage`
   * quand l'utilisateur valide un cadrage détecté, `envoyerMalgreRefus` quand l'utilisateur force
   * malgré un refus) — jamais dupliquée entre eux. `zone` OMISE (`undefined`) = photo ENTIÈRE,
   * aucun recadrage — c'est le cas « Utiliser la photo entière » (`utiliserPhotoEntiere`), qui
   * s'appuie sur le comportement déjà documenté de `reduireImagePourEnvoi` plutôt que de recalculer
   * un rectangle plein cadre ici.
   */
  async function envoyerPourAnalyse(fichier: File, zone?: RectanglePixels) {
    setEtape({ phase: 'preparation' });

    let image: Awaited<ReturnType<typeof reduireImagePourEnvoi>>;
    try {
      image = await reduireImagePourEnvoi(fichier, zone);
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
        sessionExpiree:
          cause instanceof ErreurApi && cause.probleme.code === 'AUTH_SESSION_EXPIREE',
      });
    }
  }

  function envoyerMalgreRefus() {
    if (etape.phase !== 'refus') return;
    void envoyerPourAnalyse(etape.fichier, etape.zone);
  }

  /** Accepte le cadrage détecté automatiquement (`PanneauConfirmationCadrage`, action primaire). */
  function confirmerCadrage() {
    if (etape.phase !== 'cadrage') return;
    void envoyerPourAnalyse(etape.fichier, etape.zone);
  }

  /** Recours de l'« annulabilité » exigée côté produit : renonce au cadrage détecté et envoie la photo
   *  ENTIÈRE (`zone` omise, voir la doc de tête d'`envoyerPourAnalyse`). */
  function utiliserPhotoEntiere() {
    if (etape.phase !== 'cadrage') return;
    void envoyerPourAnalyse(etape.fichier, undefined);
  }

  function annulerAnalyse() {
    if (etape.phase === 'analyse') etape.controleur.abort();
    setEtape({ phase: 'capture' });
  }

  // GESTION DE LA SESSION — voir la doc de tête, § SESSION, pour le raisonnement complet (pourquoi
  // ce n'est PAS le même arbitrage que la borne d'atelier).
  if (sessionEnAttente) {
    return (
      <GabaritEcran titre={t('scan:titre')} sousTitre={t('scan:sousTitre')}>
        <EtatChargement lignes={4} />
      </GabaritEcran>
    );
  }

  // Rien d'engagé (aucune photo prise) -> redirect direct, identique à la borne (issue #159).
  if (session === null && etape.phase === 'capture') {
    return <Navigate to="/login" replace />;
  }

  // Service injoignable ET rien d'engagé -> erreur actionnable classique. Au-delà de l'étape
  // `capture`, `isError` redevient un simple confort (voir la doc de tête) : on laisse le parcours
  // déjà lancé s'afficher normalement, sans jamais l'interrompre pour ce seul motif.
  if (sessionEnErreur && etape.phase === 'capture') {
    return (
      <GabaritEcran titre={t('scan:titre')} sousTitre={t('scan:sousTitre')}>
        <EtatErreur
          titre={t('scan:session.erreur.titre')}
          description={t('scan:session.erreur.description')}
          onReessayer={() => void rafraichirSession()}
        />
      </GabaritEcran>
    );
  }

  // Session partie APRÈS qu'une photo a été prise (ou pendant tout autre travail en cours) :
  // JAMAIS un redirect silencieux qui l'effacerait — bannière explicite en tête du rendu normal
  // ci-dessous, le travail en cours reste affiché tel quel.
  const sessionPerdueEnCours = session === null && etape.phase !== 'capture';

  return (
    <GabaritEcran titre={t('scan:titre')} sousTitre={t('scan:sousTitre')}>
      <div className="flex flex-col gap-6">
        {sessionPerdueEnCours ? (
          <Alert variant="destructive">
            <LogOut className="h-4 w-4" aria-hidden="true" />
            <AlertTitle>{t('scan:session.perdueEnCours.titre')}</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-2">
              <span>{t('scan:session.perdueEnCours.description')}</span>
              <Button type="button" variant="outline" size="sm" asChild>
                <Link to="/login">{t('scan:session.seReconnecter')}</Link>
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

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
          <div className="mx-auto flex w-full max-w-md flex-col items-center gap-8 text-center">
            {/* 1. L'OBJECTIF, dit AVANT tout (retour produit : un cadre vide affiché ici ne se
                comprenait pas — voir la doc de tête de l'écran pour la cause profonde). Le
                pictogramme `IdCard` identifie le SUJET (« un document d'identité ») ; ce n'est pas
                un viseur à aligner, juste une icône dans un badge rond, sans ambiguïté possible
                avec un cadre de visée. Le titre porte le BÉNÉFICE concret (la fiche se remplit
                seule), pas seulement l'instruction. */}
            <div className="flex flex-col items-center gap-3">
              <div
                aria-hidden="true"
                className="flex h-20 w-20 items-center justify-center rounded-full bg-muted/60"
              >
                <IdCard className="h-10 w-10 text-muted-foreground" />
              </div>
              <div className="space-y-1">
                <p className="texte-corps font-medium">{t('scan:capture.objectifTitre')}</p>
                <p className="texte-libelle text-muted-foreground">
                  {t('scan:capture.objectifDetail')}
                </p>
              </div>
            </div>

            {/* 2. LE GESTE — bascule LIVE/NATIVE (`liveDisponible`, voir sa doc de tête). Le flux
                vidéo maison (`CaptureLiveCadrage.tsx`) ne remplace la capture native que sur un
                contexte sécurisé ; SANS AUCUNE trace visible du choix pour l'utilisateur (pas de
                message, pas de bouton en plus — l'un OU l'autre, jamais les deux à la fois). */}
            {liveDisponible ? (
              <CaptureLiveCadrage
                onCapture={(fichier) => void traiterFichier(fichier)}
                onIndisponible={() => setLiveDisponible(false)}
              />
            ) : (
              <>
                {/* Capture native (`capture="environment"`) — repli par défaut tant que le site ne
                    sert pas en HTTPS, voir `disponibiliteCaptureLive.ts`. `accept="image/*"` reste
                    large (pas `image/jpeg` seul) pour laisser l'appareil choisir son propre format
                    natif ; `reduireImage.ts` gère la conversion, HEIC compris, avant l'envoi. */}
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
                {/* Action PRIMAIRE unique de cette étape, pensée pour un pouce, une seule main
                    (h-14, 56 px, bien au-dessus du plancher tactile de 44 px du produit). Le conseil
                    de prise de vue est un simple rappel, juste au-dessus, jamais dominant. */}
                <div className="flex w-full flex-col items-center gap-3">
                  <p className="texte-libelle text-muted-foreground">
                    {t('scan:capture.conseilPriseDeVue')}
                  </p>
                  <Button
                    type="button"
                    className="h-14 w-full gap-2 texte-annexe"
                    onClick={() => inputRef.current?.click()}
                  >
                    <Camera className="h-5 w-5" aria-hidden="true" />
                    {t('scan:capture.action')}
                  </Button>
                </div>
              </>
            )}
          </div>
        ) : null}

        {etape.phase === 'controleQualite' ? (
          <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 py-10 text-center">
            <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" aria-hidden="true" />
            <p role="status" className="texte-corps font-medium">
              {t('scan:controleQualite.enCours')}
            </p>
          </div>
        ) : null}

        {etape.phase === 'refus' ? (
          <PanneauRefusPhoto
            urlApercu={etape.urlApercu}
            fractions={etape.fractions}
            motif={etape.motif}
            onReprendre={recommencer}
            onEnvoyerQuandMeme={envoyerMalgreRefus}
          />
        ) : null}

        {etape.phase === 'cadrage' ? (
          <PanneauConfirmationCadrage
            urlApercu={etape.urlApercu}
            fractions={etape.fractions}
            onContinuer={confirmerCadrage}
            onPhotoEntiere={utiliserPhotoEntiere}
          />
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
            {etape.sessionExpiree ? (
              // Session partie ENTRE la prise de la photo et le retour du serveur — voir la doc
              // de tête, § SESSION PERDUE PENDANT L'APPEL OCR. « Reprendre une photo » échouerait
              // à l'identique : seule la reconnexion permet de continuer.
              <Button type="button" asChild>
                <Link to="/login">{t('scan:session.seReconnecter')}</Link>
              </Button>
            ) : (
              <Button type="button" onClick={recommencer}>
                {t('scan:actions.reessayer')}
              </Button>
            )}
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
 * SERVEUR (le lot OCR, en réponse à `POST /scan/permis-circulation` quand `correspondances`
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
