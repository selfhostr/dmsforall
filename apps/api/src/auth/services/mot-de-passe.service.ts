/**
 * Implémentation Argon2id de `ServiceMotDePasse` (contrat gelé étape 0, §2.10).
 *
 * `@node-rs/argon2` (binaires napi-rs précompilés) plutôt que le paquet `argon2` (module natif
 * node-gyp) : sur le poste de dev (Windows, Node 24), aucun prebuild de `argon2` n'existe encore
 * pour cette version de Node, et sa compilation exigerait Visual Studio Build Tools. Même
 * algorithme (Argon2id), même format de sortie PHC (`$argon2id$v=19$m=...,t=...,p=...$...`),
 * juste une API différente et zéro compilation. Décision d'l'équipe base de données, appliquée ici.
 */
import { Inject, Injectable } from '@nestjs/common';
import { hash, verify, type Algorithm } from '@node-rs/argon2';

/**
 * Identifiant Argon2id dans `@node-rs/argon2` (Argon2d = 0, Argon2i = 1, Argon2id = 2).
 *
 * La valeur est recopiée plutôt qu'importée : `Algorithm` y est déclaré en `const enum`, dont
 * l'accès est impossible sous `isolatedModules` (chaque fichier étant transpilé isolément, le
 * compilateur ne peut pas remplacer le membre par sa valeur). Le type, lui, reste importé, donc
 * une divergence entre cette constante et l'énumération serait signalée à la compilation.
 *
 * Argon2id et non Argon2i ou Argon2d : c'est l'hybride recommandé par l'OWASP et la RFC 9106
 * pour le hachage de mots de passe — résistant à la fois aux attaques par canal auxiliaire et
 * au cassage massivement parallèle sur GPU.
 */
const ARGON2ID: Algorithm = 2;

import { JETON_CONFIG } from '../../config/config.jetons';
import type { Config } from '../../config/config.types';
import type { ServiceMotDePasse } from '../auth.types';

/**
 * Mot de passe factice, jamais utilisé pour un vrai compte, dont le hash est calculé une seule
 * fois au démarrage et réutilisé pour `verifierLeurre()`. N'importe quelle chaîne de longueur
 * réaliste conviendrait : Argon2 paie le même coût CPU quel que soit le résultat de la
 * comparaison, la valeur exacte n'a aucune importance de sécurité.
 */
const MOT_DE_PASSE_LEURRE = 'leurre-anti-enumeration-dfa-ne-correspond-a-aucun-compte-reel';

/** Extrait `m`/`t`/`p` d'un hash PHC Argon2id (`$argon2id$v=19$m=19456,t=2,p=1$...`). */
const MOTIF_PARAMETRES_PHC = /^\$argon2id\$v=\d+\$m=(\d+),t=(\d+),p=(\d+)\$/;

interface ParametresArgon2 {
  readonly memoryCost: number;
  readonly timeCost: number;
  readonly parallelism: number;
}

function parametresDuHash(hash: string): ParametresArgon2 | null {
  const correspondance = MOTIF_PARAMETRES_PHC.exec(hash);
  if (!correspondance) return null;
  const [, m, t, p] = correspondance;
  return { memoryCost: Number(m), timeCost: Number(t), parallelism: Number(p) };
}

@Injectable()
export class ServiceMotDePasseArgon2id implements ServiceMotDePasse {
  /**
   * Calculé une seule fois, mémoïsé dans une promesse plutôt que dans un hook `OnModuleInit` :
   * un premier appel à `verifierLeurre()` qui arriverait avant la fin du hook de cycle de vie
   * attendrait quand même la même promesse au lieu d'échouer ou de recalculer.
   */
  private readonly hashLeurre: Promise<string>;

  constructor(@Inject(JETON_CONFIG) private readonly config: Config) {
    this.hashLeurre = this.hacher(MOT_DE_PASSE_LEURRE);
  }

  private options(): ParametresArgon2 & { algorithm: Algorithm } {
    return {
      algorithm: ARGON2ID,
      memoryCost: this.config.ARGON2_MEMOIRE_KIB,
      timeCost: this.config.ARGON2_ITERATIONS,
      parallelism: this.config.ARGON2_PARALLELISME,
    };
  }

  async hacher(clair: string): Promise<string> {
    return hash(clair, this.options());
  }

  async verifier(hashStocke: string, clair: string): Promise<boolean> {
    try {
      return await verify(hashStocke, clair);
    } catch {
      // Hash malformé/algorithme inconnu : jamais une vraie erreur serveur du point de vue de
      // l'appelant, juste « ce mot de passe ne correspond pas ».
      return false;
    }
  }

  async verifierLeurre(): Promise<void> {
    const hashStocke = await this.hashLeurre;
    // Résultat volontairement ignoré : seul le coût CPU (identique à un verifier() réel) compte,
    // pour que le temps de réponse de POST /auth/connexion ne révèle pas si l'email existe.
    await verify(hashStocke, MOT_DE_PASSE_LEURRE).catch(() => false);
  }

  doitEtreRehache(hashStocke: string): boolean {
    // `@node-rs/argon2` n'expose pas d'équivalent à `needsRehash()` : on parse nous-mêmes l'en-tête
    // PHC (`$argon2id$v=19$m=...,t=...,p=...$`) et on compare aux paramètres courants.
    const parametres = parametresDuHash(hashStocke);
    if (!parametres) return true; // hash illisible ou autre algorithme → à rehacher
    const attendus = this.options();
    return (
      parametres.memoryCost !== attendus.memoryCost ||
      parametres.timeCost !== attendus.timeCost ||
      parametres.parallelism !== attendus.parallelism
    );
  }
}
