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
}

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
