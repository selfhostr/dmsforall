/**
 * `GET|PATCH /parametres-entreprise/envoi-courriel` et `POST …/test` — le serveur d'envoi
 * des e-mails du garage (relances, factures, mots de passe oubliés).
 *
 * Droit unique `parametrage.envoi_courriel.gerer` : direction et admin (comptes de gestion), jamais
 * le chef d'atelier ni les autres rôles. Le garage est celui de la session ; le mot de passe n'est
 * jamais renvoyé.
 */
import { Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  schemaModificationEnvoiCourriel,
  schemaTestEnvoiCourriel,
  type EntreeModificationEnvoiCourriel,
  type EntreeTestEnvoiCourriel,
} from '@dfa/shared';

import { ServiceContexteRequete } from '../../common/contexte';
import { CorpsZod } from '../../common/documentation';
import { ExigerDroit } from '../../common/droits';
import { ApiReponseProbleme } from '../../common/erreurs';
import { ServiceReglageEnvoiCourriel } from '../../courriel';
import {
  ReponseEnvoiCourrielDto,
  ReponseTestEnvoiCourrielDto,
} from '../dto/reponse-envoi-courriel.dto';

@ApiTags('Paramétrage')
@ApiCookieAuth()
@Controller('parametres-entreprise/envoi-courriel')
export class EnvoiCourrielController {
  constructor(
    private readonly service: ServiceReglageEnvoiCourriel,
    private readonly contexte: ServiceContexteRequete,
  ) {}

  @ExigerDroit('parametrage.envoi_courriel.gerer')
  @Get()
  @ApiOperation({
    summary: 'Serveur d’envoi des e-mails du garage et état courant.',
    description:
      'Priorité : réglage du garage > serveur de l’instance (SMTP_*) > aucun envoi. `source` dit ce ' +
      'qui sert réellement ; `configure: false` = « non configuré ». Le mot de passe n’est jamais ' +
      'renvoyé, seulement `reglage.motDePasseDefini`. `reglage.dernierTest` garde le résultat du dernier ' +
      'e-mail d’essai (remis à `null` à chaque modification).',
  })
  @ApiOkResponse({ type: ReponseEnvoiCourrielDto })
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'DROIT_INSUFFISANT — réservé à la direction et à l’administrateur.')
  async obtenir(): Promise<ReponseEnvoiCourrielDto> {
    return this.service.obtenir(this.contexte.contexteTenant());
  }

  @ExigerDroit('parametrage.envoi_courriel.gerer')
  @Patch()
  @ApiOperation({
    summary:
      'Enregistre le serveur d’envoi du garage (hôte, port, sécurité, identifiants, expéditeur).',
    description:
      'Création au premier appel : `hote`, `port`, `securite` et `adresseExpediteur` sont alors ' +
      'obligatoires (`VALIDATION_ECHOUEE` sinon). Ensuite, seuls les champs envoyés changent. ' +
      '`securite` : `tls_implicite` (port 465 en général), `starttls` (587) ou `aucune` (réseau de ' +
      'confiance uniquement). `motDePasse` absent = inchangé, `null` = effacé, texte = remplacé ; il est ' +
      'chiffré au repos (`COURRIEL_CLE_CHIFFREMENT_ABSENTE` si le serveur n’a pas de clé). ' +
      'Changer `hote` ou `utilisateur` sans renvoyer `motDePasse` efface l’ancien mot de passe. ' +
      'Chaque changement est journalisé (avant/après, jamais le secret) et remet le dernier test à zéro. ' +
      'En production, un hôte sur réseau privé est refusé à l’envoi sauf `COURRIEL_RESEAU_PRIVE_AUTORISE`.',
  })
  @ApiOkResponse({ type: ReponseEnvoiCourrielDto })
  @ApiReponseProbleme(400, 'VALIDATION_ECHOUEE — champ invalide ou réglage incomplet.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'DROIT_INSUFFISANT.')
  @ApiReponseProbleme(
    409,
    'COURRIEL_CLE_CHIFFREMENT_ABSENTE — impossible de stocker un mot de passe.',
  )
  async modifier(
    @CorpsZod(schemaModificationEnvoiCourriel, {
      exemple: {
        hote: 'mail.infomaniak.com',
        port: 587,
        securite: 'starttls',
        utilisateur: 'atelier@garage-martin.ch',
        motDePasse: 'mot-de-passe-du-compte',
        adresseExpediteur: 'atelier@garage-martin.ch',
        nomAffiche: 'Garage Martin',
      },
    })
    corps: EntreeModificationEnvoiCourriel,
  ): Promise<ReponseEnvoiCourrielDto> {
    return this.service.modifier(this.contexte.contexteTenant(), corps);
  }

  @ExigerDroit('parametrage.envoi_courriel.gerer')
  @Post('test')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Envoie un e-mail d’essai avec le réglage enregistré du garage.',
    description:
      'Teste le réglage ENREGISTRÉ (enregistrer d’abord). L’envoi est réel même hors production : ' +
      'geste explicite de la direction, vers la seule adresse indiquée. La langue du message est celle ' +
      'de la personne connectée. Le résultat est conservé (`reglage.dernierTest`). Échecs en ' +
      'problem+json 422 : `COURRIEL_AUTHENTIFICATION_ECHEC`, `COURRIEL_CONNEXION_ECHEC` (serveur injoignable ' +
      'ou hôte interdit), `COURRIEL_TLS_ECHEC`, `COURRIEL_ENVOI_ECHEC` (message refusé) ; 409 ' +
      '`COURRIEL_NON_CONFIGURE` s’il n’y a pas de réglage. Jamais le message brut du serveur.',
  })
  @ApiOkResponse({ type: ReponseTestEnvoiCourrielDto })
  @ApiReponseProbleme(400, 'VALIDATION_ECHOUEE — adresse du destinataire invalide.')
  @ApiReponseProbleme(401, 'Session absente ou expirée.')
  @ApiReponseProbleme(403, 'DROIT_INSUFFISANT.')
  @ApiReponseProbleme(409, 'COURRIEL_NON_CONFIGURE — aucun réglage enregistré.')
  @ApiReponseProbleme(
    422,
    'COURRIEL_AUTHENTIFICATION_ECHEC, COURRIEL_CONNEXION_ECHEC, COURRIEL_TLS_ECHEC ou COURRIEL_ENVOI_ECHEC.',
  )
  async tester(
    @CorpsZod(schemaTestEnvoiCourriel, { exemple: { destinataire: 'direction@garage-martin.ch' } })
    corps: EntreeTestEnvoiCourriel,
  ): Promise<ReponseTestEnvoiCourrielDto> {
    return this.service.tester(
      this.contexte.contexteTenant(),
      corps.destinataire,
      this.contexte.exigerPrincipal().langue,
    );
  }
}
