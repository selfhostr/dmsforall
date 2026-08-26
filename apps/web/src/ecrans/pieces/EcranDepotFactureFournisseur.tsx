import { AlertCircle, CheckCircle2, Loader2, UploadCloud, WifiOff, XCircle } from 'lucide-react';
import { useRef, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { ReponseFactureFournisseur, RoleUtilisateur } from '@dfa/shared';

import { ErreurReseau, messageErreur } from '@/api/erreurs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { GabaritEcran } from '@/composants/motifs/GabaritEcran';
import { useDeposerFactureFournisseur } from '@/hooks/pieces/useDeposerFactureFournisseur';
import { useRejeterFactureFournisseur } from '@/hooks/pieces/useRejeterFactureFournisseur';
import { useValiderRapprochementFactureFournisseur } from '@/hooks/pieces/useValiderRapprochementFactureFournisseur';
import { useSession } from '@/hooks/useSession';
import { cn } from '@/lib/utils';

import { peutDeciderFactureFournisseur, peutDeposerFactureFournisseur } from './droits';
import { PanneauRapprochementFacture } from './PanneauRapprochementFacture';

/** 15 Mo — garde CLIENT avant envoi (un PDF ne se réduit pas côté client comme une photo, voir
 *  `factures-fournisseur.api.ts` : la garde serveur, 413, reste la seule fiable, celle-ci
 *  n'évite qu'un aller-retour réseau inutile pour un fichier manifestement trop lourd). */
const TAILLE_MAX_OCTETS = 15 * 1024 * 1024;

/**
 * MACHINE À ÉTATS — même doctrine que `ecrans/scan/EcranScan.tsx` (chaque étape du parcours est un
 * état DISTINCT, jamais une combinaison de booléens indépendants). `decidee` couvre les DEUX issues
 * terminales de `facture.statut` (`validee`/`rejetee`, `@dfa/shared`) — jamais deux états séparés :
 * les deux se distinguent par le CONTENU de `facture`, pas par une phase à part.
 */
type EtapeDepot =
  | { readonly phase: 'depot' }
  | { readonly phase: 'analyse'; readonly controleur: AbortController }
  | { readonly phase: 'rapprochement'; readonly facture: ReponseFactureFournisseur }
  | { readonly phase: 'decidee'; readonly facture: ReponseFactureFournisseur }
  | {
      readonly phase: 'erreur';
      readonly categorie: 'fichier' | 'reseau' | 'serveur';
      readonly message: string;
    };

/**
 * ÉCRAN DÉPÔT — dépose une facture fournisseur (PDF, poste fixe, jamais de photo mobile — décision
 * de @laupernoe), attend la lecture serveur (quelques secondes, annulable), puis affiche le rapprochement
 * (`PanneauRapprochementFacture`, partagé avec `EcranFactureFournisseur`) et laisse le magasinier
 * décider EXPLICITEMENT — valider OU rejeter (« aucune validation automatique », brief ; le rejet,
 * `POST .../rejeter`, motif obligatoire, est réel côté contrat — `EntreeRejetFactureFournisseur`).
 *
 * JAMAIS DE FAUX SUCCÈS (issue #63, même doctrine que `EcranScan`) : la phase `decidee` n'est
 * atteinte qu'après une confirmation serveur RÉELLE (`valider` ou `rejeter`), jamais localement.
 * Toute panne (fichier, réseau, serveur) a son propre état d'erreur explicite, réessayable.
 */
export function EcranDepotFactureFournisseur() {
  const { t } = useTranslation(['pieces', 'commun', 'erreurs']);
  const session = useSession();
  const role = session.data?.utilisateur.role;
  const deposer = useDeposerFactureFournisseur();

  const [etape, setEtape] = useState<EtapeDepot>({ phase: 'depot' });
  const [survolDropzone, setSurvolDropzone] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function recommencer() {
    setEtape({ phase: 'depot' });
  }

  function validerFichier(fichier: File): string | null {
    const estPdf =
      fichier.type === 'application/pdf' || fichier.name.toLowerCase().endsWith('.pdf');
    if (!estPdf) return t('pieces:facturesFournisseur.erreurs.fichierPasPdf');
    if (fichier.size > TAILLE_MAX_OCTETS) {
      return t('pieces:facturesFournisseur.erreurs.fichierTropLourd');
    }
    return null;
  }

  async function traiterFichier(fichier: File) {
    const erreurFichier = validerFichier(fichier);
    if (erreurFichier) {
      setEtape({ phase: 'erreur', categorie: 'fichier', message: erreurFichier });
      return;
    }

    const controleur = new AbortController();
    setEtape({ phase: 'analyse', controleur });
    try {
      const facture = await deposer.mutateAsync({ fichier, signal: controleur.signal });
      setEtape({ phase: 'rapprochement', facture });
    } catch (cause) {
      if (controleur.signal.aborted) return; // annulation explicite — déjà revenu à 'depot'
      setEtape({
        phase: 'erreur',
        categorie: cause instanceof ErreurReseau ? 'reseau' : 'serveur',
        message: messageErreur(cause, t),
      });
    }
  }

  function annulerAnalyse() {
    if (etape.phase === 'analyse') etape.controleur.abort();
    setEtape({ phase: 'depot' });
  }

  function surDepot(evenement: DragEvent<HTMLDivElement>) {
    evenement.preventDefault();
    setSurvolDropzone(false);
    const fichier = evenement.dataTransfer.files[0];
    if (fichier) void traiterFichier(fichier);
  }

  if (session.isLoading) {
    return (
      <GabaritEcran titre={t('pieces:facturesFournisseur.titreDepot')}>
        <EtatChargement lignes={4} />
      </GabaritEcran>
    );
  }

  if (!peutDeposerFactureFournisseur(role)) {
    return (
      <GabaritEcran titre={t('pieces:facturesFournisseur.titreDepot')}>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          <AlertDescription>{t('pieces:facturesFournisseur.droitRequis.depot')}</AlertDescription>
        </Alert>
      </GabaritEcran>
    );
  }

  return (
    <GabaritEcran
      titre={t('pieces:facturesFournisseur.titreDepot')}
      sousTitre={t('pieces:facturesFournisseur.sousTitreDepot')}
    >
      <div className="flex flex-col gap-section">
        {etape.phase === 'depot' ? (
          // Pas de sémantique `role="button"`/clic sur le conteneur : le SEUL affordance
          // clic/clavier est le bouton « Choisir un fichier » ci-dessous — deux éléments
          // interactifs empilés (un conteneur focusable ET un vrai `<button>` à l'intérieur)
          // créeraient un ordre de tabulation confus pour un lecteur d'écran. Le glisser-déposer
          // reste géré directement sur ce conteneur (`onDragOver`/`onDrop`), indépendant du clic.
          <div
            data-testid="zone-depot-facture-fournisseur"
            onDragOver={(evenement) => {
              evenement.preventDefault();
              setSurvolDropzone(true);
            }}
            onDragLeave={() => setSurvolDropzone(false)}
            onDrop={surDepot}
            // Bordure CONSERVÉE (DESIGN.md « bordure structurelle uniquement ») : zone de dépôt
            // de fichier, exemple nommé explicitement de zone à comportement distinct (glisser-
            // déposer) — pas un simple groupe de contenu.
            className={cn(
              'flex flex-col items-center gap-groupe rounded-lg border-2 border-dashed p-12 text-center transition-colors',
              survolDropzone ? 'border-primary bg-muted/40' : 'border-input',
            )}
          >
            <UploadCloud className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
            <div className="space-y-1">
              <p className="texte-corps font-medium">
                {t('pieces:facturesFournisseur.depot.consigneTitre')}
              </p>
              <p className="texte-libelle text-muted-foreground">
                {t('pieces:facturesFournisseur.depot.consigneDetail')}
              </p>
            </div>
            <p className="texte-libelle text-muted-foreground">
              {t('pieces:facturesFournisseur.depot.glisserDeposer')}
              {' — '}
              {t('pieces:facturesFournisseur.depot.ou')}
            </p>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="sr-only"
              aria-label={t('pieces:facturesFournisseur.depot.parcourir')}
              onChange={(evenement) => {
                const fichier = evenement.target.files?.[0];
                evenement.target.value = '';
                if (fichier) void traiterFichier(fichier);
              }}
            />
            <Button type="button" onClick={() => inputRef.current?.click()}>
              {t('pieces:facturesFournisseur.depot.parcourir')}
            </Button>
          </div>
        ) : null}

        {etape.phase === 'analyse' ? (
          <div className="mx-auto flex w-full max-w-md flex-col items-center gap-6 py-10 text-center">
            <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" aria-hidden="true" />
            <p role="status" className="texte-corps font-medium">
              {t('pieces:facturesFournisseur.analyse.enCours')}
            </p>
            <Button type="button" variant="outline" onClick={annulerAnalyse}>
              {t('commun:actions.annuler')}
            </Button>
          </div>
        ) : null}

        {etape.phase === 'erreur' ? (
          <div className="mx-auto flex w-full max-w-md flex-col gap-groupe">
            <Alert variant={etape.categorie === 'reseau' ? 'avertissement' : 'destructive'}>
              {etape.categorie === 'reseau' ? (
                <WifiOff className="h-4 w-4" aria-hidden="true" />
              ) : (
                <AlertCircle className="h-4 w-4" aria-hidden="true" />
              )}
              <AlertTitle>{t('pieces:facturesFournisseur.erreurs.titre')}</AlertTitle>
              <AlertDescription>{etape.message}</AlertDescription>
            </Alert>
            <Button type="button" onClick={recommencer}>
              {t('commun:actions.reessayer')}
            </Button>
          </div>
        ) : null}

        {etape.phase === 'rapprochement' ? (
          <PanneauRapprochementFactureAvecDecision
            facture={etape.facture}
            role={role}
            onDecidee={(facture) => setEtape({ phase: 'decidee', facture })}
          />
        ) : null}

        {etape.phase === 'decidee' ? (
          <div className="mx-auto flex w-full max-w-md flex-col gap-groupe">
            <Alert variant={etape.facture.statut === 'rejetee' ? 'destructive' : 'default'}>
              {etape.facture.statut === 'rejetee' ? (
                <XCircle className="h-4 w-4" aria-hidden="true" />
              ) : (
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              )}
              <AlertTitle>
                {t(
                  etape.facture.statut === 'rejetee'
                    ? 'pieces:facturesFournisseur.validation.succesTitreRejet'
                    : 'pieces:facturesFournisseur.validation.succesTitre',
                )}
              </AlertTitle>
            </Alert>
            <Button type="button" variant="outline" asChild>
              <Link to={`/pieces/factures-fournisseur/${etape.facture.id}`}>
                {t('pieces:facturesFournisseur.actions.consulter')}
              </Link>
            </Button>
            <Button type="button" onClick={recommencer}>
              {t('pieces:facturesFournisseur.actions.deposerUneAutre')}
            </Button>
          </div>
        ) : null}
      </div>
    </GabaritEcran>
  );
}

interface PropsAvecDecision {
  readonly facture: ReponseFactureFournisseur;
  readonly role: RoleUtilisateur | undefined;
  readonly onDecidee: (facture: ReponseFactureFournisseur) => void;
}

/** Câble `useValiderRapprochementFactureFournisseur`/`useRejeterFactureFournisseur` autour du
 *  panneau partagé — composant à part pour que l'écran de consultation
 *  (`EcranFactureFournisseur.tsx`) puisse recâbler les MÊMES mutations SANS dupliquer ce fil (id
 *  différent à chaque montage : `useMutation` doit être réinstancié par fiche, jamais partagé
 *  entre deux id). */
function PanneauRapprochementFactureAvecDecision({ facture, role, onDecidee }: PropsAvecDecision) {
  const valider = useValiderRapprochementFactureFournisseur(facture.id);
  const rejeter = useRejeterFactureFournisseur(facture.id);

  return (
    <PanneauRapprochementFacture
      facture={facture}
      peutDecider={peutDeciderFactureFournisseur(role)}
      validationEnCours={valider.isPending}
      rejetEnCours={rejeter.isPending}
      erreurValidation={valider.error}
      erreurRejet={rejeter.error}
      avecTitre
      onValider={() => valider.mutate(undefined, { onSuccess: onDecidee })}
      onRejeter={(motif) => rejeter.mutate({ motif }, { onSuccess: onDecidee })}
    />
  );
}
