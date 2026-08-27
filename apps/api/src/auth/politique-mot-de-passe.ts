/**
 * Politique de mot de passe — le volet qu'un schéma zod ne peut pas exprimer (`@dfa/shared`,
 * `contrats/auth.ts`, `schemaMotDePasseNouveau`, POUR le raisonnement complet sur le choix de
 * politique). Zod garantit déjà la longueur (12 à 256) ; CE fichier ajoute, côté serveur
 * uniquement :
 *
 *  1. le refus des mots de passe connus comme compromis/trop communs (NIST SP 800-63B) ;
 *  2. le refus d'un mot de passe qui contient trivialement l'adresse courriel du compte.
 *
 * Pourquoi PAS dans `@dfa/shared` : ce module est consommé par `apps/web` (bundle navigateur) —
 * y embarquer même une liste MODESTE de mots de passe courants grossirait le bundle pour un
 * bénéfice nul (le contrôle qui compte est celui du serveur ; un contrôle client ne fait
 * qu'améliorer le message d'erreur avant soumission, hors périmètre de cette tâche).
 *
 * HONNÊTETÉ SUR LA PORTÉE : la liste ci-dessous est une liste CURATÉE des mots de passe les plus
 * documentés comme les plus fréquents dans les fuites publiques largement analysées (SplashData/
 * NordPass « pires mots de passe de l'année », listes RockYou) — PAS un service d'API externe
 * type « Have I Been Pwned » (k-anonymat), qui exigerait un appel réseau sortant vers un tiers non
 * suisse à CHAQUE changement de mot de passe, contraire à la doctrine d'hébergement CH/nLPD de ce
 * produit (voir CONTRIBUTING.md : « 100% navigateur, hébergement CH »). C'est un filet contre le pire
 * cas (mots de passe triviaux), pas une preuve d'absence dans TOUTE fuite connue — une distinction
 * assumée, pas une lacune cachée.
 */

import { Injectable } from '@nestjs/common';

import { ErreurMetier } from '../common/erreurs';

/**
 * Mots de passe les plus documentés comme compromis/devinables — normalisés en minuscules.
 * Mélange délibéré : séquences numériques/clavier, vocabulaire anglais/français/allemand/italien
 * (marché CH), motifs « mot + chiffres » déjà écrits en toutes lettres (une variante avec des
 * chiffres différents n'est PAS bloquée par cette liste seule — voir `estMotifTrivial` ci-dessous
 * pour les motifs structurels, qui couvrent ce qu'une liste statique ne peut pas énumérer).
 */
const MOTS_DE_PASSE_COURANTS: ReadonlySet<string> = new Set(
  [
    // --- Séquences numériques/clavier ---
    '123456789012',
    '1234567890123',
    '12345678901234',
    'qwertyuiop',
    'qwertyuiop12',
    'azertyuiop',
    'azertyuiop12',
    '1q2w3e4r5t',
    '1qaz2wsx3edc',
    'zxcvbnm1234',
    // --- Anglais, tel quel ou en variante longueur ≥ 12 ---
    'password1234',
    'password12345',
    'iloveyou1234',
    'letmein12345',
    'welcome12345',
    'sunshine1234',
    'princess1234',
    'football1234',
    'baseball1234',
    'dragonball123',
    'trustno1trust',
    'superman1234',
    'batman123456',
    'whatever1234',
    'ilovemyself1',
    'changeme12345',
    'default123456',
    'admin12345678',
    'administrator',
    'letmein123456',
    'passw0rd12345',
    'p@ssw0rd12345',
    'iloveyousomuch',
    'nevergonnagiveup',
    // --- Français ---
    'motdepasse123',
    'motdepasse1234',
    'bonjourbonjour',
    'soleilsoleil12',
    'jetaime1234567',
    'bienvenue12345',
    'azertyazerty12',
    'changerlemdp12',
    // --- Allemand (marché suisse alémanique) ---
    'passwort12345',
    'passwort123456',
    'willkommen123',
    'schweiz123456',
    'hallo12345678',
    'sonnenschein1',
    // --- Italien (marché suisse italophone) ---
    'passwordmio12',
    'benvenuto1234',
    'ciaociao12345',
    'sole1234567890',
    // --- Métier garage / valeurs par défaut plausibles ---
    'garage1234567',
    'garage12345678',
    'atelier123456',
    'atelier1234567',
    'demo1234garage',
    'motdepassetemp',
    'temporary12345',
    'changeit123456',
  ].map((mdp) => mdp.toLowerCase()),
);

/**
 * Motifs STRUCTURELS triviaux — un caractère unique répété, ou une séquence strictement
 * croissante/décroissante (alphabet ou chiffres) sur toute la longueur. Complète la liste
 * statique ci-dessus : `'aaaaaaaaaaaa'` ou `'abcdefghijkl'` ne figureront jamais tous dans une
 * liste énumérée à la main, mais sont tout aussi devinables en une fraction de seconde.
 */
function estMotifTrivial(motDePasse: string): boolean {
  const minuscule = motDePasse.toLowerCase();

  if (new Set(minuscule).size === 1) return true; // caractère unique répété

  const codes = [...minuscule].map((c) => c.codePointAt(0) ?? 0);
  const croissant = codes.every((c, i) => i === 0 || c === codes[i - 1]! + 1);
  const decroissant = codes.every((c, i) => i === 0 || c === codes[i - 1]! - 1);
  return croissant || decroissant;
}

/** `true` si `motDePasse` contient trivialement la partie locale (avant `@`) de `email`. Ignoré
 *  si la partie locale fait moins de 4 caractères (trop court pour être un signal fiable — un
 *  mot de passe légitime pourrait contenir la sous-chaîne par pur hasard). */
function contientEmail(motDePasse: string, email: string): boolean {
  const partieLocale = email.trim().toLowerCase().split('@')[0] ?? '';
  if (partieLocale.length < 4) return false;
  return motDePasse.toLowerCase().includes(partieLocale);
}

export interface IndicesMotDePasse {
  readonly email: string;
}

/**
 * Lève `VALIDATION_ECHOUEE` si `motDePasse` est un mot de passe connu comme compromis/trop
 * commun, un motif trivial, ou contient l'adresse courriel du compte. À appeler APRÈS la
 * validation structurelle zod (`schemaMotDePasseNouveau`, longueur), jamais à sa place.
 */
@Injectable()
export class ServicePolitiqueMotDePasse {
  verifier(motDePasse: string, indices: IndicesMotDePasse): void {
    const normalise = motDePasse.trim().toLowerCase();

    if (MOTS_DE_PASSE_COURANTS.has(normalise) || estMotifTrivial(motDePasse)) {
      throw new ErreurMetier(
        'VALIDATION_ECHOUEE',
        'Ce mot de passe est trop commun ou trop prévisible — choisissez-en un autre.',
        {
          erreurs: [
            {
              champ: 'nouveauMotDePasse',
              code: 'mot_de_passe_trop_commun',
              message: 'Ce mot de passe figure parmi les plus fréquemment compromis.',
            },
          ],
        },
      );
    }

    if (contientEmail(motDePasse, indices.email)) {
      throw new ErreurMetier(
        'VALIDATION_ECHOUEE',
        'Le mot de passe ne doit pas contenir votre adresse courriel.',
        {
          erreurs: [
            {
              champ: 'nouveauMotDePasse',
              code: 'mot_de_passe_contient_email',
              message: 'Le mot de passe ne doit pas contenir votre adresse courriel.',
            },
          ],
        },
      );
    }
  }
}
