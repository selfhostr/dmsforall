import type { CauseEchecEnvoiCourriel } from '@dfa/shared';
import nodemailer, { type Transporter } from 'nodemailer';
import type { ConfigSmtpResolue } from './config-courriel';
import type {
  EnveloppeCourriel,
  ResultatEnvoiCourriel,
  TransportCourriel,
} from './transport-courriel.interface';

/** Délais courts : un test d'envoi ou une relance ne doit pas rester suspendu sur un serveur muet. */
const DELAI_CONNEXION_MS = 10_000;
const DELAI_SOCKET_MS = 30_000;

const CODES_CONNEXION = new Set([
  'ECONNECTION',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EDNS',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

/**
 * Classe un échec nodemailer en famille compréhensible par un garagiste. Les messages bruts des
 * serveurs ne sont jamais montrés : ils peuvent citer des adresses ou des noms d'utilisateur.
 */
export function classerEchecSmtp(erreur: unknown): CauseEchecEnvoiCourriel {
  const e = erreur as { code?: unknown; responseCode?: unknown; message?: unknown } | null;
  const code = typeof e?.code === 'string' ? e.code : '';
  const message = typeof e?.message === 'string' ? e.message.toLowerCase() : '';
  if (code === 'EAUTH') return 'authentification';
  if (
    code === 'ETLS' ||
    code.startsWith('ERR_SSL') ||
    code.startsWith('ERR_TLS') ||
    code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    /wrong version number|certificate|ssl|tls/.test(message)
  ) {
    return 'tls';
  }
  if (CODES_CONNEXION.has(code) || code === 'ESOCKET') return 'connexion';
  if (code === 'EENVELOPE' || code === 'EMESSAGE' || typeof e?.responseCode === 'number') {
    return 'refuse';
  }
  return 'inconnue';
}

/**
 * Transport SMTP réel (nodemailer). Pour l'instance, construit UNIQUEMENT par
 * `courriel.module.ts` quand `courrielDoitEnvoyerReellement(config)` est vrai ; pour un garage,
 * construit par `FabriqueTransportSmtp` à partir de son réglage. Ce fichier ne relit jamais
 * `process.env` ni ne teste `NODE_ENV` : la décision est prise en amont.
 */
export class TransportSmtp implements TransportCourriel {
  private readonly transporteur: Transporter;

  constructor(config: ConfigSmtpResolue) {
    const securite = config.securite;
    this.transporteur = nodemailer.createTransport({
      host: config.adresseConnexion ?? config.hote,
      port: config.port,
      secure: securite === undefined ? config.securise : securite === 'tls_implicite',
      ...(securite === 'starttls' ? { requireTLS: true } : {}),
      ...(securite === 'aucune' ? { ignoreTLS: true } : {}),
      ...(config.adresseConnexion ? { tls: { servername: config.hote } } : {}),
      ...(config.sansAuthentification
        ? {}
        : { auth: { user: config.utilisateur, pass: config.motDePasse } }),
      connectionTimeout: DELAI_CONNEXION_MS,
      greetingTimeout: DELAI_CONNEXION_MS,
      socketTimeout: DELAI_SOCKET_MS,
    });
  }

  async envoyer(enveloppe: EnveloppeCourriel): Promise<ResultatEnvoiCourriel> {
    try {
      const info = await this.transporteur.sendMail({
        from: { name: enveloppe.nomExpediteurAffiche, address: enveloppe.de },
        replyTo: enveloppe.repondreA,
        to: enveloppe.destinataires.join(', '),
        subject: enveloppe.sujet,
        text: enveloppe.corpsTexte,
        html: enveloppe.corpsHtml,
        // Taille cumulée déjà bornée par `ServiceCourriel.envoyer` (`TAILLE_MAX_PIECE_JOINTE_
        // OCTETS`) avant que ce transport ne soit même atteint — ce fichier ne revalide rien, il
        // ne fait que traduire vers la forme attendue par nodemailer.
        attachments: enveloppe.piecesJointes?.map((piece) => ({
          filename: piece.nomFichier,
          content: piece.contenu,
          contentType: piece.typeMime,
        })),
      });
      return { succes: true, idMessage: info.messageId };
    } catch (erreur) {
      return {
        succes: false,
        erreur: erreur instanceof Error ? erreur.message : String(erreur),
        cause: classerEchecSmtp(erreur),
      };
    }
  }
}
