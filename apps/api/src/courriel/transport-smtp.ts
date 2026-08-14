import nodemailer, { type Transporter } from 'nodemailer';
import type { ConfigSmtpResolue } from './config-courriel';
import type {
  EnveloppeCourriel,
  ResultatEnvoiCourriel,
  TransportCourriel,
} from './transport-courriel.interface';

/**
 * Transport SMTP réel (nodemailer, Infomaniak). Construit UNIQUEMENT par `courriel.module.ts`
 * quand `courrielDoitEnvoyerReellement(config)` est vrai — voir `config-courriel.ts` pour le
 * verrou à deux clés (`NODE_ENV=production` ET `COURRIEL_ENVOI_REEL=true`). Ce fichier ne relit
 * jamais `process.env` ni ne teste `NODE_ENV` lui-même : la décision est déjà prise en amont, ce
 * qui rend ce transport trivialement testable en l'instanciant directement avec des identifiants
 * de test.
 */
export class TransportSmtp implements TransportCourriel {
  private readonly transporteur: Transporter;

  constructor(config: ConfigSmtpResolue) {
    this.transporteur = nodemailer.createTransport({
      host: config.hote,
      port: config.port,
      secure: config.securise,
      auth: { user: config.utilisateur, pass: config.motDePasse },
    });
  }

  async envoyer(enveloppe: EnveloppeCourriel): Promise<ResultatEnvoiCourriel> {
    try {
      const info = await this.transporteur.sendMail({
        from: `"${enveloppe.nomExpediteurAffiche}" <${enveloppe.de}>`,
        replyTo: enveloppe.repondreA,
        to: enveloppe.destinataires.join(', '),
        subject: enveloppe.sujet,
        text: enveloppe.corpsTexte,
        html: enveloppe.corpsHtml,
      });
      return { succes: true, idMessage: info.messageId };
    } catch (erreur) {
      return {
        succes: false,
        erreur: erreur instanceof Error ? erreur.message : String(erreur),
      };
    }
  }
}
