/**
 * Enveloppe d'un courriel à envoyer — interface ÉTROITE, socle seul. Aucun gabarit HTML
 * métier, aucune logique de relance : l'appelant (un futur module « relances », « facturation »,
 * « invitation utilisateur »…) construit le sujet et le corps, l'i18n du contenu est SA
 * responsabilité, pas celle de ce module.
 *
 * `de`/`nomExpediteurAffiche` ne sont JAMAIS fournis par l'appelant : ils sont calculés par
 * `ServiceCourriel` à partir de la config (`SMTP_EXPEDITEUR`, toujours `no-reply@dmsforall.example`)
 * et du nom de garage transmis — voir `service-courriel.ts`. Cette interface décrit ce qu'un
 * `TransportCourriel` reçoit UNE FOIS ces deux champs déjà résolus.
 */
export interface EnveloppeCourriel {
  /** Adresse d'expédition technique — toujours `SMTP_EXPEDITEUR` (no-reply@dmsforall.example),
   *  jamais une adresse de garage (pas de SPF/DKIM du garage, le courriel tomberait en spam). */
  readonly de: string;
  /** Nom affiché de l'expéditeur, ex. « Garage Martin via dmsforall ». */
  readonly nomExpediteurAffiche: string;
  /** `Reply-To` — l'adresse de réponse du garage, jamais `de`. */
  readonly repondreA: string;
  readonly destinataires: readonly string[];
  readonly sujet: string;
  readonly corpsTexte?: string;
  readonly corpsHtml?: string;
  /** Pièce(s) jointe(s) — typiquement le PDF d'une facture émise
   *  (`facturation/impression/generation-pdf-facture.ts`). Taille cumulée bornée par
   *  `TAILLE_MAX_PIECE_JOINTE_OCTETS`, vérifiée par `ServiceCourriel.envoyer` AVANT tout appel au
   *  transport — ni `TransportSmtp` ni `TransportCapture` ne revalident cette borne, elle n'a
   *  qu'un seul point de contrôle. */
  readonly piecesJointes?: readonly PieceJointeCourriel[];
}

/**
 * Une pièce jointe déjà résolue en mémoire — pas de chemin de fichier, pas de flux : l'appelant
 * (aujourd'hui aucun ; demain un module `facturation`/`documents-vente` qui aura déjà produit le
 * PDF via `genererPdfFacture`) tient le `Buffer` complet avant d'appeler `ServiceCourriel`, ce
 * socle ne sait ni lire ni streamer un fichier. Aucune validation de type MIME/contenu ici, seule
 * la taille est bornée — voir `TAILLE_MAX_PIECE_JOINTE_OCTETS`.
 */
export interface PieceJointeCourriel {
  /** Nom de fichier suggéré au client de messagerie, ex. `Facture-2026-00042.pdf`. ATTENTION —
   *  donnée à traiter comme potentiellement sensible : un numéro de facture ou de dossier peut
   *  indirectement identifier un client. Jamais journalisé au niveau `info`/`warn` (voir
   *  `TransportCapture`/`ServiceCourriel`), réservé au niveau `debug`, même doctrine que
   *  `destinataires`/`sujet`/`repondreA`. */
  readonly nomFichier: string;
  readonly contenu: Buffer;
  /** Type MIME, ex. `application/pdf`. Transmis tel quel au transport — ce socle ne le déduit
   *  jamais du nom de fichier ni de son contenu. */
  readonly typeMime: string;
}

/**
 * Borne dure sur la taille CUMULÉE des pièces jointes d'UNE enveloppe — 8 Mio (8 × 1024 × 1024
 * octets). Une facture QR (`facturation/impression/generation-pdf-facture.ts`, PDFKit — texte et
 * bulletin QR vectoriels, aucune image embarquée) pèse quelques centaines de kilo-octets, rarement
 * plus d'un ou deux mégaoctets même pour une facture à plusieurs dizaines de lignes : 8 Mio laisse
 * une marge large (4 à 8×) sans laisser passer n'importe quoi. Le prestataire SMTP retenu
 * (Infomaniak, voir `config-courriel.ts`) plafonne lui-même autour de 25 Mio par message — ce
 * module refuse donc BIEN AVANT cette limite prestataire, plutôt que de laisser `nodemailer`
 * échouer en pleine négociation SMTP avec une erreur de protocole peu lisible. Un dépassement ici
 * signale presque toujours une erreur de l'appelant (mauvais buffer, contenu dupliqué), jamais un
 * besoin métier légitime non couvert par cette marge.
 */
export const TAILLE_MAX_PIECE_JOINTE_OCTETS = 8 * 1024 * 1024;

/** Résultat d'un envoi, quel que soit le transport (réel ou capture). */
export interface ResultatEnvoiCourriel {
  readonly succes: boolean;
  /** Identifiant de message rendu par le transport (SMTP : `Message-Id` ; capture : un
   *  identifiant local, pour pouvoir corréler un envoi capturé à son log). */
  readonly idMessage?: string;
  /** Message d'erreur si `succes` est faux — jamais la pile complète (voir `ServiceJournal`
   *  pour où la pile atterrit réellement). */
  readonly erreur?: string;
}

/**
 * Deux implémentations derrière cette interface : `TransportSmtp` (nodemailer, envoi réel) et
 * `TransportCapture` (dev/test, aucun envoi réseau). La sélection entre les deux se fait par la
 * configuration (`courriel.module.ts`), jamais par un `if (process.env.NODE_ENV)` dispersé dans
 * le code appelant.
 */
export interface TransportCourriel {
  envoyer(enveloppe: EnveloppeCourriel): Promise<ResultatEnvoiCourriel>;
}
