/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  /** Numéro de version + hash court du commit (`+modifié` si l'arbre était sale au moment du
   *  build), injecté à la compilation par `vite.config.ts` (`define`) — jamais lu depuis un
   *  fichier `.env`. Sous Vitest (`vitest.config.ts`, config séparée sans ce `define`), cette
   *  clé est simplement absente de `import.meta.env` à l'exécution malgré ce typage : voir
   *  `composants/layout/MenuUtilisateur.tsx` pour le repli défensif (`typeof … === 'string'`)
   *  qui traite ce cas comme une vraie valeur manquante, jamais comme une exception. */
  readonly VITE_DFA_VERSION_INFO: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
