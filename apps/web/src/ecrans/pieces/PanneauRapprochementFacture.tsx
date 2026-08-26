import { CheckCircle2, FileText, XCircle } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { ReponseFactureFournisseur, ReponseLigneFactureFournisseur } from '@dfa/shared';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { obtenirEnv } from '@/config/env';
import { TableComptoir, type ColonneComptoir } from '@/composants/comptoir/TableComptoir';
import { useCommandeFournisseur } from '@/hooks/pieces/useCommandeFournisseur';
import { useFournisseur } from '@/hooks/pieces/useFournisseur';
import { formaterDate, formaterDateHeure, formaterMontant } from '@/lib/formats';

import { BadgeStatutFactureFournisseur } from './BadgeStatutFactureFournisseur';
import { DialogueMotifCommandeFournisseur } from './DialogueMotifCommandeFournisseur';
import { IndicateurCertitude } from './IndicateurCertitude';
import { messageErreurMutation } from './messages-erreur-mutation';
import { PastilleEcart } from './PastilleEcart';
import {
  calculerSyntheseEcarts,
  certitudeChampEnTete,
  certitudeChampLigne,
  deriverNatureEcart,
  formaterMontantEcart,
  formaterQuantiteEcart,
} from './utils-factures-fournisseur';
import { formaterQuantiteMillieme, texteOuVide } from './utils';

interface Props {
  readonly facture: ReponseFactureFournisseur;
  /** Décider (valider OU rejeter) — MÊME droit côté matrice (magasinier seul, brief : « le
   *  magasinier confirme »). `false`/props de mutation absentes -> aucune action rendue (lecture
   *  seule), même quand `facture.statut` le permettrait encore côté serveur. */
  readonly peutDecider: boolean;
  readonly onValider?: () => void;
  readonly onRejeter?: (motif: string) => void;
  readonly validationEnCours?: boolean;
  readonly rejetEnCours?: boolean;
  readonly erreurValidation?: unknown;
  readonly erreurRejet?: unknown;
  /** `true` sur l'écran de dépôt (juste après l'analyse) — élève le titre du panneau au niveau
   *  `h2` puisque `EcranDepotFactureFournisseur` porte déjà le `h1` du gabarit. Sur la fiche de
   *  consultation (`EcranFactureFournisseur`), `GabaritEcran` porte DÉJÀ le titre de la page : ce
   *  panneau n'en pose alors aucun de son cru (prop absente/`false`). */
  readonly avecTitre?: boolean;
}

/**
 * Cœur du dépôt : rend LISIBLES l'en-tête lue, le rapprochement (fournisseur ET commande, ou leur
 * absence, dite clairement), et les écarts ligne à ligne — voir le brief (« l'information la plus
 * importante de l'écran »). Partagé entre `EcranDepotFactureFournisseur` (juste après l'analyse) et
 * `EcranFactureFournisseur` (consultation d'une facture déjà déposée) — jamais dupliqué entre les
 * deux, même principe que `FormulairePermisScanne` partagé entre les issues du scan.
 *
 * `useCommandeFournisseur`/`useFournisseur` : requêtes SECONDAIRES, jamais bloquantes à elles
 * seules (même doctrine que `EcranFicheCommandeFournisseur#requeteFournisseur`) — la commande/le
 * fournisseur rapprochés enrichissent l'affichage (référence, nom) mais leur absence de réponse
 * n'empêche jamais de lire/valider/rejeter la facture elle-même.
 */
export function PanneauRapprochementFacture({
  facture,
  peutDecider,
  onValider,
  onRejeter,
  validationEnCours = false,
  rejetEnCours = false,
  erreurValidation,
  erreurRejet,
  avecTitre = false,
}: Props) {
  const { t } = useTranslation(['pieces', 'commun', 'erreurs']);
  const [dialogueRejetOuvert, setDialogueRejetOuvert] = useState(false);

  const urlDocument = `${obtenirEnv().VITE_API_URL}/factures-fournisseur/${facture.id}/document`;
  const synthese = calculerSyntheseEcarts(facture.lignes);

  const requeteCommande = useCommandeFournisseur(facture.commandeFournisseurId ?? undefined);
  const requeteFournisseur = useFournisseur(facture.fournisseurId ?? undefined);
  const lignesCommandeParId = new Map(
    (requeteCommande.data?.lignes ?? []).map((ligneCommande) => [ligneCommande.id, ligneCommande]),
  );

  const decisionPossible =
    peutDecider && (facture.statut === 'deposee' || facture.statut === 'rapprochee');

  // Un appel par champ d'en-tête tracé (`CHAMPS_FACTURE_FOURNISSEUR`, `@dfa/shared`) plutôt qu'un
  // indexeur générique `facture[champ]` : TypeScript ne peut pas prouver qu'un
  // `ChampFactureFournisseur` (union de littéraux définie à côté du type `ReponseFactureFournisseur`,
  // pas dérivée de `keyof` celui-ci) indexe valablement l'objet — explicite, mais type-sûr.
  const certitudeNumeroFacture = certitudeChampEnTete(
    facture.numeroFacture,
    'numeroFacture',
    facture.champsOrigine,
  );
  const certitudeDateFacture = certitudeChampEnTete(
    facture.dateFacture,
    'dateFacture',
    facture.champsOrigine,
  );
  const certitudeNomCreancier = certitudeChampEnTete(
    facture.nomCreancier,
    'nomCreancier',
    facture.champsOrigine,
  );
  const certitudeIbanCreancier = certitudeChampEnTete(
    facture.ibanCreancier,
    'ibanCreancier',
    facture.champsOrigine,
  );
  const certitudeReferencePaiement = certitudeChampEnTete(
    facture.referencePaiement,
    'referencePaiement',
    facture.champsOrigine,
  );
  const certitudeMontantTotal = certitudeChampEnTete(
    facture.montantTotalCentimes,
    'montantTotalCentimes',
    facture.champsOrigine,
  );
  const certitudeDevise = certitudeChampEnTete(facture.devise, 'devise', facture.champsOrigine);

  const colonnes: ColonneComptoir<ReponseLigneFactureFournisseur>[] = [
    {
      id: 'ecart',
      libelle: t('pieces:facturesFournisseur.lignes.colonnes.ecart'),
      rendu: (ligne) => <PastilleEcart nature={deriverNatureEcart(ligne)} />,
    },
    {
      id: 'designation',
      libelle: t('pieces:facturesFournisseur.lignes.colonnes.designation'),
      rendu: (ligne) => (
        <div className="flex flex-col gap-0.5">
          <ChampValeurLue
            valeur={ligne.designation}
            certitude={certitudeChampLigne(ligne.designation, ligne.origine)}
          />
          {ligne.referenceArticle ? (
            <span className="texte-libelle text-muted-foreground">{ligne.referenceArticle}</span>
          ) : null}
        </div>
      ),
    },
    {
      id: 'quantite',
      libelle: t('pieces:facturesFournisseur.lignes.colonnes.quantite'),
      alignement: 'droite',
      rendu: (ligne) => {
        const ligneCommandee = ligne.commandeFournisseurLigneId
          ? lignesCommandeParId.get(ligne.commandeFournisseurLigneId)
          : undefined;
        return (
          <div className="flex flex-col items-end gap-0.5">
            <ChampValeurLue
              valeur={formaterQuantiteMillieme(ligne.quantiteMillieme)}
              certitude={certitudeChampLigne(ligne.quantiteMillieme, ligne.origine)}
            />
            {ligneCommandee ? (
              <span className="texte-libelle text-muted-foreground">
                {t('pieces:facturesFournisseur.lignes.commande', {
                  valeur: formaterQuantiteMillieme(ligneCommandee.quantiteCommandeeMillieme),
                })}
              </span>
            ) : null}
            {ligne.ecart && ligne.ecart.quantiteMillieme !== 0 ? (
              <span className="texte-libelle font-medium text-avertissement">
                {t('pieces:facturesFournisseur.lignes.ecartValeur', {
                  unites: formaterQuantiteEcart(ligne.ecart.quantiteMillieme),
                })}
              </span>
            ) : null}
          </div>
        );
      },
    },
    {
      id: 'prixUnitaire',
      libelle: t('pieces:facturesFournisseur.lignes.colonnes.prixUnitaire'),
      alignement: 'droite',
      rendu: (ligne) => {
        const ligneCommandee = ligne.commandeFournisseurLigneId
          ? lignesCommandeParId.get(ligne.commandeFournisseurLigneId)
          : undefined;
        return (
          <div className="flex flex-col items-end gap-0.5">
            <ChampValeurLue
              valeur={
                ligne.prixUnitaireCentimes !== null
                  ? formaterMontant(ligne.prixUnitaireCentimes)
                  : null
              }
              certitude={certitudeChampLigne(ligne.prixUnitaireCentimes, ligne.origine)}
            />
            {ligneCommandee?.prixAchatAttenduCentimes !== null &&
            ligneCommandee?.prixAchatAttenduCentimes !== undefined ? (
              <span className="texte-libelle text-muted-foreground">
                {t('pieces:facturesFournisseur.lignes.commande', {
                  valeur: formaterMontant(ligneCommandee.prixAchatAttenduCentimes),
                })}
              </span>
            ) : null}
            {ligne.ecart && ligne.ecart.prixUnitaireCentimes !== 0 ? (
              <span className="texte-libelle font-medium text-avertissement">
                {t('pieces:facturesFournisseur.lignes.ecartValeur', {
                  unites: formaterMontantEcart(ligne.ecart.prixUnitaireCentimes),
                })}
              </span>
            ) : null}
          </div>
        );
      },
    },
    {
      id: 'total',
      libelle: t('pieces:facturesFournisseur.lignes.colonnes.total'),
      alignement: 'droite',
      rendu: (ligne) => (
        <div className="flex flex-col items-end gap-0.5">
          <ChampValeurLue
            valeur={
              ligne.totalLigneCentimes !== null ? formaterMontant(ligne.totalLigneCentimes) : null
            }
            certitude={certitudeChampLigne(ligne.totalLigneCentimes, ligne.origine)}
          />
          {ligne.ecart && ligne.ecart.totalCentimes !== 0 ? (
            <span className="texte-libelle font-medium text-avertissement">
              {t('pieces:facturesFournisseur.lignes.ecartValeur', {
                unites: formaterMontantEcart(ligne.ecart.totalCentimes),
              })}
            </span>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-section">
      {avecTitre ? (
        <h2 className="texte-titre-section">
          {t('pieces:facturesFournisseur.rapprochement.titre')}
        </h2>
      ) : null}

      {/* Bordure retirée (DESIGN.md) : bandeau d'identité du document, simple groupe de
          contenu sans comportement propre — surface tonale à la place, jamais cumulée avec un
          trait (même mécanisme que `EnTeteOrdreReparation.tsx`, atelier). */}
      <div className="flex flex-wrap items-center justify-between gap-controles rounded-md bg-muted/40 p-3">
        <div className="flex flex-wrap items-center gap-2 texte-corps font-medium">
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          {facture.numeroFacture ?? t('pieces:facturesFournisseur.sansNumero')}
          <BadgeStatutFactureFournisseur statut={facture.statut} />
          <span className="texte-libelle font-normal text-muted-foreground">
            {t('pieces:facturesFournisseur.deposeeLe', {
              date: formaterDateHeure(facture.document.deposeLe),
            })}
          </span>
        </div>
        {/* PAS `BoutonImprimerDocument` (`composants/motifs/`) ici — mesuré, chantier
            d'unification inter-écrans, 25.08.2026 : deux divergences réelles, pas de la
            paresse à absorber dans le générique.
            1. TAILLE — ce bouton vit dans un bandeau d'identité DENSE (icône `h-4 w-4`, badge,
               texte `texte-corps`, `p-3`), pas dans une rangée d'actions d'en-tête ; `size="sm"`
               aligne sa hauteur sur celle des autres éléments de CE bandeau. `BoutonImprimerOr`
               (atelier) et le branchement facturation vivent, eux, dans une vraie rangée
               d'actions à côté de boutons `size="default"` — même raisonnement, tailles
               opposées : les deux contextes ont chacun raison pour leur propre rangée.
            2. LIBELLÉ/ICÔNE — « Voir le document » (geste de VÉRIFICATION du rapprochement,
               pas d'impression) n'est volontairement pas doublé d'une icône `Printer` : les
               deux AUTRES points de branchement disent « Imprimer » et portent cette icône à
               dessein (le mot ET le pictogramme promettent la même chose). Un pictogramme
               d'imprimante à côté du mot « voir » promettrait un geste que ce bouton ne fait
               pas — vocabulaire garagiste, jamais un mot pour un autre (consigne du chantier).
            `BoutonImprimerDocument` fixe l'icône ET la taille par construction (voir son
            en-tête) : lui ajouter une variante de taille/icône pour ce seul appelant aurait
            paramétré le générique pour une divergence qui ne s'y prête pas proprement — mêmes
            `<a href target="_blank" rel="noopener noreferrer">`/mêmes garanties issue #155,
            habillage local délibérément conservé. */}
        <Button type="button" variant="outline" size="sm" asChild>
          <a href={urlDocument} target="_blank" rel="noopener noreferrer">
            {t('pieces:facturesFournisseur.actions.voirDocument')}
          </a>
        </Button>
      </div>

      <div className="flex flex-col gap-controles sm:flex-row">
        {facture.fournisseurId ? (
          <Alert className="flex-1">
            <AlertTitle>
              {t('pieces:facturesFournisseur.rapprochement.fournisseurTrouveTitre')}
            </AlertTitle>
            <AlertDescription>
              <Link
                to={`/pieces/fournisseurs/${facture.fournisseurId}`}
                className="texte-corps font-medium text-primary underline"
              >
                {requeteFournisseur.data?.nom ?? facture.nomCreancier ?? facture.fournisseurId}
              </Link>
            </AlertDescription>
          </Alert>
        ) : (
          <Alert variant="avertissement" className="flex-1">
            <AlertTitle>
              {t('pieces:facturesFournisseur.rapprochement.fournisseurAbsentTitre')}
            </AlertTitle>
            <AlertDescription>
              {t('pieces:facturesFournisseur.rapprochement.fournisseurAbsentDescription')}
            </AlertDescription>
          </Alert>
        )}

        {facture.commandeFournisseurId ? (
          <Alert className="flex-1">
            <AlertTitle>
              {t('pieces:facturesFournisseur.rapprochement.commandeTrouveeTitre')}
            </AlertTitle>
            <AlertDescription>
              <Link
                to={`/pieces/commandes-fournisseur/${facture.commandeFournisseurId}`}
                className="texte-corps font-medium text-primary underline"
              >
                {requeteCommande.data?.reference ??
                  (requeteCommande.data ? formaterDate(requeteCommande.data.dateCommande) : null) ??
                  facture.commandeFournisseurId}
              </Link>
            </AlertDescription>
          </Alert>
        ) : (
          <Alert variant="avertissement" className="flex-1">
            <AlertTitle>
              {t('pieces:facturesFournisseur.rapprochement.commandeAbsenteTitre')}
            </AlertTitle>
            <AlertDescription>
              {t('pieces:facturesFournisseur.rapprochement.commandeAbsenteDescription')}
            </AlertDescription>
          </Alert>
        )}
      </div>

      <div className="flex flex-col gap-controles">
        <h3 className="texte-titre-section">{t('pieces:facturesFournisseur.enTete.titre')}</h3>
        <div className="grid grid-cols-1 gap-groupe sm:grid-cols-2 lg:grid-cols-3">
          <ChampEnTete
            libelle={t('pieces:facturesFournisseur.enTete.numeroFacture')}
            valeur={facture.numeroFacture}
            certitude={certitudeNumeroFacture}
          />
          <ChampEnTete
            libelle={t('pieces:facturesFournisseur.enTete.dateFacture')}
            valeur={facture.dateFacture !== null ? formaterDate(facture.dateFacture) : null}
            certitude={certitudeDateFacture}
          />
          <ChampEnTete
            libelle={t('pieces:facturesFournisseur.enTete.fournisseur')}
            valeur={facture.nomCreancier}
            certitude={certitudeNomCreancier}
          />
          <ChampEnTete
            libelle={t('pieces:facturesFournisseur.enTete.iban')}
            valeur={facture.ibanCreancier}
            certitude={certitudeIbanCreancier}
          />
          <ChampEnTete
            libelle={t('pieces:facturesFournisseur.enTete.referencePaiement')}
            valeur={facture.referencePaiement}
            certitude={certitudeReferencePaiement}
          />
          <ChampEnTete
            libelle={t('pieces:facturesFournisseur.enTete.montantTotal')}
            valeur={
              facture.montantTotalCentimes !== null
                ? formaterMontant(facture.montantTotalCentimes)
                : null
            }
            certitude={certitudeMontantTotal}
          />
          <ChampEnTete
            libelle={t('pieces:facturesFournisseur.enTete.devise')}
            valeur={facture.devise}
            certitude={certitudeDevise}
          />
        </div>
      </div>

      {/* SYNTHÈSE DES ÉCARTS — « l'information la plus importante de l'écran, elle doit sauter aux
          yeux » (brief). Bannière dédiée, avant le détail ligne à ligne. */}
      {synthese.nombreLignesAvecEcart > 0 ? (
        <Alert variant="avertissement">
          <AlertTitle>
            {t('pieces:facturesFournisseur.synthese.titreAvecEcarts', {
              count: synthese.nombreLignesAvecEcart,
            })}
          </AlertTitle>
          <AlertDescription>
            {synthese.ecartTotalCentimes !== 0
              ? t('pieces:facturesFournisseur.synthese.detailMontant', {
                  montant: formaterMontantEcart(synthese.ecartTotalCentimes),
                })
              : t('pieces:facturesFournisseur.synthese.detailSansMontant')}
          </AlertDescription>
        </Alert>
      ) : (
        <Alert>
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          <AlertTitle>{t('pieces:facturesFournisseur.synthese.titreSansEcart')}</AlertTitle>
        </Alert>
      )}

      <TableComptoir
        colonnes={colonnes}
        lignes={facture.lignes}
        cleLigne={(ligne) => ligne.id}
        contenuVide={
          <p className="text-muted-foreground">{t('pieces:facturesFournisseur.lignes.vide')}</p>
        }
      />

      {facture.statut === 'validee' ? (
        <Alert>
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          <AlertTitle>
            {t('pieces:facturesFournisseur.validation.dejaValidee', {
              date: facture.valideLe ? formaterDateHeure(facture.valideLe) : '',
            })}
          </AlertTitle>
        </Alert>
      ) : facture.statut === 'rejetee' ? (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" aria-hidden="true" />
          <AlertTitle>{t('pieces:facturesFournisseur.validation.dejaRejetee')}</AlertTitle>
          {facture.motifRejet ? <AlertDescription>{facture.motifRejet}</AlertDescription> : null}
        </Alert>
      ) : decisionPossible ? (
        <div className="flex flex-col gap-2">
          {erreurValidation ? (
            <p className="texte-libelle text-destructive" role="alert">
              {messageErreurMutation(erreurValidation, t)}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={validationEnCours || rejetEnCours} onClick={onValider}>
              {validationEnCours
                ? t('commun:chargement.enCours')
                : t('pieces:facturesFournisseur.actions.valider')}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={validationEnCours || rejetEnCours}
              onClick={() => setDialogueRejetOuvert(true)}
            >
              {t('pieces:facturesFournisseur.actions.rejeter')}
            </Button>
          </div>
        </div>
      ) : null}

      {onRejeter ? (
        <DialogueMotifCommandeFournisseur
          ouvert={dialogueRejetOuvert}
          titre={t('pieces:facturesFournisseur.rejet.titre')}
          description={t('pieces:facturesFournisseur.rejet.description')}
          libelleAction={t('pieces:facturesFournisseur.actions.rejeter')}
          enCours={rejetEnCours}
          erreur={erreurRejet}
          onFermer={() => setDialogueRejetOuvert(false)}
          onConfirmer={(motif) => {
            onRejeter(motif);
            setDialogueRejetOuvert(false);
          }}
        />
      ) : null}
    </div>
  );
}

interface PropsChampEnTete {
  readonly libelle: string;
  readonly valeur: string | null;
  readonly certitude: ReturnType<typeof certitudeChampEnTete>;
}

function ChampEnTete({ libelle, valeur, certitude }: PropsChampEnTete) {
  return (
    // Bordure retirée (DESIGN.md « bordure structurelle uniquement ») : sept cellules
    // libellé+valeur en grille — l'espacement (`gap-groupe` de la grille parente) et le poids
    // du libellé suffisent à séparer chaque champ, exactement le grief « padding vide » que ce
    // motif reproduisait. Surface tonale légère à la place, jamais un trait.
    <div className="flex flex-col gap-1 rounded-md bg-muted/40 p-3">
      <span className="texte-libelle text-muted-foreground">{libelle}</span>
      <ChampValeurLue valeur={valeur} certitude={certitude} tailleTexte="texte-corps font-medium" />
    </div>
  );
}

interface PropsChampValeurLue {
  readonly valeur: string | null;
  readonly certitude: ReturnType<typeof certitudeChampEnTete>;
  readonly tailleTexte?: string;
}

/** Rendu d'une valeur lue — jamais vide/`0.00` pour une valeur `absente` (brief : « absence de
 *  donnée ≠ valeur »), toujours accompagné de son `IndicateurCertitude` sauf quand elle est
 *  `'certaine'` (silence = état de confiance par défaut, cohérent avec `PastilleEcart` qui ne
 *  rend rien non plus pour `'aucun'`). */
function ChampValeurLue({ valeur, certitude, tailleTexte }: PropsChampValeurLue) {
  const texte = valeur === null ? '—' : texteOuVide(valeur);
  return (
    <div className="flex flex-col gap-0.5">
      <span className={tailleTexte ?? 'texte-corps'}>{texte}</span>
      {certitude !== 'certaine' ? <IndicateurCertitude certitude={certitude} /> : null}
    </div>
  );
}
