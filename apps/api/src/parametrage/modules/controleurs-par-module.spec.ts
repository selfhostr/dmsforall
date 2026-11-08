/**
 * Garde structurelle : chaque contrôleur d'un module activable porte `@ExigerModule('<module>')`.
 * Sans elle, un nouveau contrôleur de `pieces/`, `ventes/`… resterait inscriptible alors que le
 * garage a retiré le module — en silence. Le comportement du garde est testé dans
 * `common/droits/garde-module.spec.ts`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ModuleApp } from '@dfa/shared';

const RACINE = join(__dirname, '..', '..');

function controleurs(dossier: string, recursif = true): string[] {
  const sortie: string[] = [];
  for (const nom of readdirSync(join(RACINE, dossier))) {
    const chemin = join(RACINE, dossier, nom);
    if (statSync(chemin).isDirectory()) {
      if (recursif) sortie.push(...controleurs(join(dossier, nom)));
    } else if (/\.controller\.ts$/.test(nom)) {
      sortie.push(relative(RACINE, chemin));
    }
  }
  return sortie;
}

const ATTENDU: Array<[ModuleApp, string[]]> = [
  [
    'atelier',
    [
      'atelier/devis-complementaire.controller.ts',
      'atelier/devis-vers-or.controller.ts',
      'atelier/impression/impression-devis.controller.ts',
      'atelier/impression/impression-or.controller.ts',
      'atelier/ligne-or.controller.ts',
      'atelier/ordre-reparation.controller.ts',
      'atelier/ordre-reparation-transitions.controller.ts',
      'atelier/photos/photos-ligne.controller.ts',
    ],
  ],
  ['courtoisie', ['atelier/courtoisie/courtoisie.controller.ts']],
  ['planning', controleurs('rendezvous')],
  ['pointage', ['pointage/pointage.controller.ts', 'pointage/pointage-periode.controller.ts']],
  ['tablettes', ['pointage/pin.controller.ts', 'socle/borne.controller.ts']],
  ['pieces', controleurs('pieces')],
  ['ventes', controleurs('ventes')],
  ['pneus', controleurs('pneus')],
  ['relances', ['relances/relances.controller.ts']],
  ['export_fiduciaire', ['facturation/export/export-comptable.controller.ts']],
];

describe('@ExigerModule — contrôleurs des modules activables', () => {
  for (const [module, fichiers] of ATTENDU) {
    it(`${module} : ${fichiers.length} fichier(s), chaque @Controller porte @ExigerModule('${module}')`, () => {
      expect(fichiers.length).toBeGreaterThan(0);
      for (const fichier of fichiers) {
        const source = readFileSync(join(RACINE, fichier), 'utf8');
        const nbControleurs = (source.match(/^@Controller\(/gm) ?? []).length;
        const nbDecores = (
          source.match(new RegExp(`^@ExigerModule\\('${module}'\\)\\n@Controller\\(`, 'gm')) ?? []
        ).length;
        expect(nbControleurs, fichier).toBeGreaterThan(0);
        expect(nbDecores, fichier).toBe(nbControleurs);
      }
    });
  }
});
