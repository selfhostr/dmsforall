/**
 * Jeu de démonstration « complet » — personnes et parc : collaborateurs, clients (particuliers et
 * entreprises, contacts, adresses, notes, consentements, conditions), véhicules (plaques VS/VD/GE,
 * kilométrages, expertises MFK échues ou proches, campagnes, travaux reportés) et paramétrage
 * annexe (postes de travail, activités indirectes). Voir `seed-complement-outils.ts`.
 */
import {
  choisir,
  entre,
  ins,
  iso,
  jour,
  ajouterJours,
  sql,
  prochainNumero,
  type Ctx,
} from './seed-complement-outils';

export interface ClientDemo {
  readonly id: string;
  readonly numero: string;
  readonly type: 'particulier' | 'entreprise';
  readonly designation: string;
  readonly ide: string | null;
  readonly langue: string;
  readonly adresse: { rue: string; npa: string; localite: string };
  readonly vehicules: string[];
}

export interface VehiculeDemo {
  readonly id: string;
  readonly clientId: string;
  readonly plaque: string;
  readonly libelle: string;
  readonly km: number;
}

const PRENOMS_F = [
  'Sophie',
  'Claire',
  'Nathalie',
  'Isabelle',
  'Fabienne',
  'Céline',
  'Valérie',
  'Amélie',
  'Laetitia',
  'Sandra',
  'Monique',
  'Anne-Catherine',
];
const PRENOMS_M = [
  'Pierre',
  'Jean-Marc',
  'Michel',
  'Olivier',
  'Stéphane',
  'Christophe',
  'Nicolas',
  'Alexandre',
  'Yannick',
  'Frédéric',
  'Bernard',
  'Cédric',
  'Romain',
  'Dominique',
];
const NOMS = [
  'Rey',
  'Carron',
  'Fournier',
  'Bonvin',
  'Délèze',
  'Dubuis',
  'Favre',
  'Gaillard',
  'Morard',
  'Zufferey',
  'Vuignier',
  'Pellissier',
  'Maret',
  'Germanier',
  'Rudaz',
  'Crettaz',
  'Bender',
  'Roduit',
  'Frossard',
  'Moret',
  'Produit',
  'Besse',
  'Clivaz',
  'Premand',
  'Gillioz',
  'Putallaz',
  'Lathion',
  'Mabillard',
  'Bagnoud',
  'Theytaz',
];
const LIEUX: ReadonlyArray<[string, string, string]> = [
  ['Rue du Rhône', '1950', 'Sion'],
  ['Avenue de la Gare', '1920', 'Martigny'],
  ['Rue de Lausanne', '1950', 'Sion'],
  ['Route de Sierre', '3960', 'Sierre'],
  ['Avenue du Simplon', '1920', 'Martigny'],
  ['Rue du Collège', '1870', 'Monthey'],
  ['Chemin des Vignes', '1964', 'Conthey'],
  ['Route de Fully', '1926', 'Fully'],
  ['Rue du Village', '1907', 'Saxon'],
  ['Route Cantonale', '1908', 'Riddes'],
  ['Rue des Alpes', '1957', 'Ardon'],
  ['Chemin du Moulin', '1963', 'Vétroz'],
  ['Route de Savièse', '1965', 'Savièse'],
  ['Place Centrale', '1996', 'Nendaz'],
  ['Rue du Bourg', '1860', 'Aigle'],
  ['Avenue de Plan', '1800', 'Vevey'],
  ['Rue de Genève', '1003', 'Lausanne'],
  ['Rue du Mont-Blanc', '1201', 'Genève'],
  ['Route d’Entremont', '1937', 'Orsières'],
  ['Rue Neuve', '1912', 'Leytron'],
];
const ENTREPRISES: ReadonlyArray<[string, string]> = [
  ['Boulangerie Dubuis Sàrl', 'Boulangerie'],
  ['Menuiserie Zufferey SA', 'Menuiserie'],
  ['Pharmacie du Rhône SA', 'Pharmacie'],
  ['Vignobles Germanier & Fils', 'Viticulture'],
  ['Électricité Clivaz SA', 'Électricité'],
  ['Transports Frossard Sàrl', 'Transport'],
  ['Hôtel des Alpes SA', 'Hôtellerie'],
  ['Commune de Vétroz', 'Collectivité'],
  ['Fiduciaire Morard & Associés', 'Fiduciaire'],
  ['Cabinet vétérinaire Bender', 'Vétérinaire'],
  ['Jardins Rudaz Sàrl', 'Paysagisme'],
];

interface ModeleCatalogue {
  readonly marque: string;
  readonly modele: string;
  readonly version: string;
  readonly carburant: string;
  readonly kw: number;
  readonly cm3: number;
  readonly boite: string;
  readonly code: string;
}
const CATALOGUE: readonly ModeleCatalogue[] = [
  {
    marque: 'Volkswagen',
    modele: 'Golf',
    version: '1.5 TSI Life',
    carburant: 'essence',
    kw: 96,
    cm3: 1498,
    boite: 'manuelle',
    code: 'WVW',
  },
  {
    marque: 'Volkswagen',
    modele: 'Polo',
    version: '1.0 TSI Style',
    carburant: 'essence',
    kw: 70,
    cm3: 999,
    boite: 'manuelle',
    code: 'WVW',
  },
  {
    marque: 'Volkswagen',
    modele: 'Tiguan',
    version: '2.0 TDI 4Motion',
    carburant: 'diesel',
    kw: 110,
    cm3: 1968,
    boite: 'automatique',
    code: 'WVG',
  },
  {
    marque: 'Skoda',
    modele: 'Octavia',
    version: 'Combi 2.0 TDI',
    carburant: 'diesel',
    kw: 85,
    cm3: 1968,
    boite: 'manuelle',
    code: 'TMB',
  },
  {
    marque: 'Skoda',
    modele: 'Fabia',
    version: '1.0 TSI Ambition',
    carburant: 'essence',
    kw: 70,
    cm3: 999,
    boite: 'manuelle',
    code: 'TMB',
  },
  {
    marque: 'Skoda',
    modele: 'Kodiaq',
    version: '2.0 TDI 4x4',
    carburant: 'diesel',
    kw: 110,
    cm3: 1968,
    boite: 'automatique',
    code: 'TMB',
  },
  {
    marque: 'Audi',
    modele: 'A3',
    version: 'Sportback 35 TFSI',
    carburant: 'essence',
    kw: 110,
    cm3: 1498,
    boite: 'automatique',
    code: 'WAU',
  },
  {
    marque: 'Audi',
    modele: 'Q5',
    version: '40 TDI quattro',
    carburant: 'diesel',
    kw: 150,
    cm3: 1968,
    boite: 'automatique',
    code: 'WAU',
  },
  {
    marque: 'BMW',
    modele: '320d',
    version: 'xDrive Touring',
    carburant: 'diesel',
    kw: 140,
    cm3: 1995,
    boite: 'automatique',
    code: 'WBA',
  },
  {
    marque: 'BMW',
    modele: 'X1',
    version: 'xDrive18d',
    carburant: 'diesel',
    kw: 110,
    cm3: 1995,
    boite: 'automatique',
    code: 'WBA',
  },
  {
    marque: 'Mercedes-Benz',
    modele: 'Classe A',
    version: 'A 200',
    carburant: 'essence',
    kw: 120,
    cm3: 1332,
    boite: 'automatique',
    code: 'WDD',
  },
  {
    marque: 'Toyota',
    modele: 'Yaris',
    version: 'Hybrid 1.5',
    carburant: 'hybride',
    kw: 85,
    cm3: 1490,
    boite: 'automatique',
    code: 'SB1',
  },
  {
    marque: 'Toyota',
    modele: 'RAV4',
    version: 'Hybrid AWD',
    carburant: 'hybride',
    kw: 160,
    cm3: 2487,
    boite: 'automatique',
    code: 'JTM',
  },
  {
    marque: 'Renault',
    modele: 'Clio',
    version: 'TCe 100 Intens',
    carburant: 'essence',
    kw: 74,
    cm3: 999,
    boite: 'manuelle',
    code: 'VF1',
  },
  {
    marque: 'Renault',
    modele: 'Captur',
    version: 'E-Tech Hybrid',
    carburant: 'hybride',
    kw: 105,
    cm3: 1598,
    boite: 'automatique',
    code: 'VF1',
  },
  {
    marque: 'Peugeot',
    modele: '208',
    version: 'PureTech 100',
    carburant: 'essence',
    kw: 74,
    cm3: 1199,
    boite: 'manuelle',
    code: 'VR3',
  },
  {
    marque: 'Peugeot',
    modele: '3008',
    version: 'BlueHDi 130',
    carburant: 'diesel',
    kw: 96,
    cm3: 1499,
    boite: 'automatique',
    code: 'VF3',
  },
  {
    marque: 'Ford',
    modele: 'Focus',
    version: '1.0 EcoBoost',
    carburant: 'essence',
    kw: 92,
    cm3: 999,
    boite: 'manuelle',
    code: 'WF0',
  },
  {
    marque: 'Opel',
    modele: 'Corsa',
    version: '1.2 Turbo',
    carburant: 'essence',
    kw: 74,
    cm3: 1199,
    boite: 'manuelle',
    code: 'VXK',
  },
  {
    marque: 'Hyundai',
    modele: 'Tucson',
    version: '1.6 T-GDi Hybrid',
    carburant: 'hybride',
    kw: 169,
    cm3: 1598,
    boite: 'automatique',
    code: 'TMA',
  },
  {
    marque: 'Kia',
    modele: 'Sportage',
    version: '1.6 CRDi',
    carburant: 'diesel',
    kw: 100,
    cm3: 1598,
    boite: 'automatique',
    code: 'U5Y',
  },
  {
    marque: 'Subaru',
    modele: 'Forester',
    version: '2.0 e-Boxer',
    carburant: 'hybride',
    kw: 110,
    cm3: 1995,
    boite: 'automatique',
    code: 'JF1',
  },
  {
    marque: 'Suzuki',
    modele: 'Vitara',
    version: '1.4 Boosterjet 4x4',
    carburant: 'essence',
    kw: 95,
    cm3: 1373,
    boite: 'manuelle',
    code: 'TSM',
  },
  {
    marque: 'Tesla',
    modele: 'Model 3',
    version: 'Long Range',
    carburant: 'electrique',
    kw: 258,
    cm3: 0,
    boite: 'automatique',
    code: '5YJ',
  },
  {
    marque: 'Fiat',
    modele: 'Ducato',
    version: 'Fourgon L2H2',
    carburant: 'diesel',
    kw: 103,
    cm3: 2184,
    boite: 'manuelle',
    code: 'ZFA',
  },
  {
    marque: 'Mercedes-Benz',
    modele: 'Sprinter',
    version: '314 CDI Fourgon',
    carburant: 'diesel',
    kw: 105,
    cm3: 2143,
    boite: 'manuelle',
    code: 'WDB',
  },
];
const COULEURS = [
  'Gris métallisé',
  'Noir',
  'Blanc',
  'Bleu nuit',
  'Rouge',
  'Argent',
  'Vert foncé',
  'Beige',
];
const ALPHA_VIN = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';

function telephoneSuisse(ctx: Ctx): { affiche: string; e164: string } {
  const pref = choisir(ctx, ['76', '77', '78', '79']);
  const a = String(entre(ctx, 100, 999));
  const b = String(entre(ctx, 10, 99));
  const c = String(entre(ctx, 10, 99));
  return { affiche: `0${pref} ${a} ${b} ${c}`, e164: `+41${pref}${a}${b}${c}` };
}

function sansAccent(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.|\.$/g, '');
}

// ---------------------------------------------------------------------------------------------
// Collaborateurs
// ---------------------------------------------------------------------------------------------

const COLLABORATEURS: ReadonlyArray<{
  cle: string;
  modele: string;
  prenom: string;
  nom: string;
  sites: string[];
  statut?: string;
}> = [
  {
    cle: 'technicien-rey',
    modele: 'technicien@garage-martin.ch',
    prenom: 'Marc',
    nom: 'Rey',
    sites: ['SION'],
  },
  {
    cle: 'technicien-fournier',
    modele: 'technicien@garage-martin.ch',
    prenom: 'Julien',
    nom: 'Fournier',
    sites: ['MARTIGNY'],
  },
  {
    cle: 'technicien-bonvin',
    modele: 'technicien@garage-martin.ch',
    prenom: 'Kevin',
    nom: 'Bonvin',
    sites: ['SION'],
  },
  {
    cle: 'chef-martigny',
    modele: 'chef.atelier@garage-martin.ch',
    prenom: 'Philippe',
    nom: 'Morard',
    sites: ['MARTIGNY'],
  },
  {
    cle: 'reception-martigny',
    modele: 'receptionniste@garage-martin.ch',
    prenom: 'Sandrine',
    nom: 'Carron',
    sites: ['MARTIGNY'],
  },
  {
    cle: 'vendeur-martigny',
    modele: 'vendeur@garage-martin.ch',
    prenom: 'Laurent',
    nom: 'Gay',
    sites: ['MARTIGNY', 'SION'],
  },
  {
    cle: 'magasinier-martigny',
    modele: 'magasinier@garage-martin.ch',
    prenom: 'Patricia',
    nom: 'Delaloye',
    sites: ['MARTIGNY'],
  },
  {
    cle: 'invite-bender',
    modele: 'technicien@garage-martin.ch',
    prenom: 'Thomas',
    nom: 'Bender',
    sites: ['SION'],
    statut: 'invite',
  },
];

/**
 * Chaque PERSONNE du jeu de démo a au moins un site et un site principal (défaut des filtres de
 * site de l'interface). Les comptes du jeu de base n'ont aucune affectation : ils reçoivent tous les
 * sites ; le site principal est l'un des sites de la personne (SION d'abord). Les invités sans site
 * restent sans principal, et la borne (compte de service) n'en a jamais (CHECK en base).
 */
async function attribuerSitesEtSitePrincipal(ctx: Ctx): Promise<void> {
  await ctx.c.query(
    `insert into utilisateur_site (tenant_id, utilisateur_id, site_id)
     select u.tenant_id, u.id, s.id
       from utilisateur u cross join site s
      where u.tenant_id = $1 and s.tenant_id = $1
        and u.role <> 'poste_atelier' and u.statut <> 'invite'
        and not exists (select 1 from utilisateur_site us where us.utilisateur_id = u.id)
     on conflict do nothing`,
    [ctx.tenantId],
  );
  await ctx.c.query(
    `update utilisateur u
        set site_principal_id = (
          select us.site_id
            from utilisateur_site us join site s on s.id = us.site_id
           where us.utilisateur_id = u.id and us.tenant_id = u.tenant_id
           order by (s.code = 'SION') desc, s.code
           limit 1)
      where u.tenant_id = $1 and u.role <> 'poste_atelier'`,
    [ctx.tenantId],
  );
}

export async function semerCollaborateurs(ctx: Ctx): Promise<void> {
  for (const col of COLLABORATEURS) {
    const email = `${sansAccent(col.prenom)}.${sansAccent(col.nom)}@garage-martin.ch`;
    const id = crypto.randomUUID();
    await ctx.c.query(
      `insert into utilisateur (id, tenant_id, email, mot_de_passe_hash, prenom, nom, langue, role, statut,
         niveau_atelier, niveau_accueil, niveau_facturation, niveau_pieces, niveau_ventes, niveau_finances,
         peut_encadrer, peut_gerer_employes, est_patron, voit_montants, voit_prix_achat, avoirs_plafonnes,
         derniere_connexion_le)
       select $3, tenant_id, $4, mot_de_passe_hash, $5, $6, langue, role, $7::statut_utilisateur,
         niveau_atelier, niveau_accueil, niveau_facturation, niveau_pieces, niveau_ventes, niveau_finances,
         peut_encadrer, peut_gerer_employes, false, voit_montants, voit_prix_achat, avoirs_plafonnes,
         case when $7 = 'actif' then now() - interval '1 day' * floor(random() * 6) else null end
       from utilisateur where tenant_id = $1 and email = $2`,
      [ctx.tenantId, col.modele, id, email, col.prenom, col.nom, col.statut ?? 'actif'],
    );
    ctx.utilisateurs.set(col.cle, id);
    if (col.statut !== 'invite') {
      for (const code of col.sites) {
        const siteId = ctx.sites.get(code);
        if (siteId) await ins(ctx, 'utilisateur_site', { utilisateurId: id, siteId });
      }
    }
  }
  // Le technicien du jeu de base travaille aussi sur les deux sites.
  const base = ctx.utilisateurs.get('technicien');
  if (base)
    for (const siteId of ctx.sites.values())
      await ins(ctx, 'utilisateur_site', { utilisateurId: base, siteId });
  await attribuerSitesEtSitePrincipal(ctx);
  // PIN de pointage des techniciens (même PIN que le technicien du jeu de base).
  const pinBase = await sql<{ pin_hash: string; site_id: string }>(
    ctx,
    `select pin_hash, site_id from pin_pointage where tenant_id = $1 limit 1`,
    [ctx.tenantId],
  );
  const modele = pinBase[0];
  const admin = ctx.utilisateurs.get('direction');
  if (modele && admin) {
    for (const cle of ['technicien-rey', 'technicien-fournier', 'technicien-bonvin']) {
      const uid = ctx.utilisateurs.get(cle);
      if (!uid) continue;
      await ins(ctx, 'pin_pointage', {
        siteId: cle === 'technicien-fournier' ? ctx.sites.get('MARTIGNY') : ctx.sites.get('SION'),
        utilisateurId: uid,
        pinHash: modele.pin_hash,
        actif: true,
        creeParUtilisateurId: admin,
        modifieParUtilisateurId: admin,
      });
    }
  }
  ctx.journaliser(
    `  ${String(COLLABORATEURS.length)} collaborateurs supplémentaires (dont une invitation en attente)`,
  );
}

// ---------------------------------------------------------------------------------------------
// Postes de travail et activités indirectes
// ---------------------------------------------------------------------------------------------

export async function semerPostesEtActivites(ctx: Ctx): Promise<void> {
  const postes: Array<[string, string, string]> = [
    ['SION', 'PONT-1', 'Pont élévateur 1'],
    ['SION', 'PONT-2', 'Pont élévateur 2'],
    ['SION', 'PONT-3', 'Pont 4 colonnes (géométrie)'],
    ['SION', 'DIAG', 'Poste de diagnostic'],
    ['MARTIGNY', 'PONT-1', 'Pont élévateur 1'],
    ['MARTIGNY', 'PONT-2', 'Pont élévateur 2'],
    ['MARTIGNY', 'PNEUS', 'Poste pneus et équilibrage'],
  ];
  for (const [site, code, libelle] of postes) {
    await ins(ctx, 'poste_travail', { siteId: ctx.sites.get(site), code, libelle, actif: true });
  }
  const activites: Array<[string, string, boolean]> = [
    ['nettoyage', 'Nettoyage et rangement', false],
    ['attente_pieces', 'Attente de pièces', false],
    ['attente_accord', 'Attente d’accord client', false],
    ['magasin', 'Magasin / réception marchandises', false],
    ['formation', 'Formation', false],
    ['pause', 'Pause', false],
    ['absence', 'Absence', false],
  ];
  for (const [code, libelle, productif] of activites) {
    await ins(ctx, 'activite_indirecte', { code, libelleFr: libelle, productif, actif: true });
  }
  ctx.journaliser(
    `  ${String(postes.length)} postes de travail, ${String(activites.length)} activités indirectes`,
  );
}

// ---------------------------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------------------------

export async function semerClients(ctx: Ctx): Promise<ClientDemo[]> {
  const resultat: ClientDemo[] = [];
  const admin = ctx.utilisateurs.get('direction') ?? null;
  const adresseDe = (): { rue: string; npa: string; localite: string; numero: string } => {
    const [rue, npa, localite] = choisir(ctx, LIEUX);
    return { rue, npa, localite, numero: String(entre(ctx, 1, 80)) };
  };

  const creer = async (spec: {
    type: 'particulier' | 'entreprise';
    nom?: string;
    prenom?: string;
    raison?: string;
    civilite?: string;
    statut?: string;
    tel?: { affiche: string; e164: string };
    langue?: string;
    email?: string;
    plusAucunContact?: boolean;
  }): Promise<ClientDemo> => {
    const n = await prochainNumero(ctx, 'client', 2000);
    const numero = `CL-${String(n).padStart(6, '0')}`;
    const adr = adresseDe();
    const tel = spec.tel ?? telephoneSuisse(ctx);
    const langue = spec.langue ?? (ctx.rnd() < 0.08 ? 'de' : 'fr');
    const email =
      spec.email ??
      (spec.type === 'particulier'
        ? `${sansAccent(spec.prenom ?? 'client')}.${sansAccent(spec.nom ?? 'x')}@${choisir(ctx, ['bluewin.ch', 'gmail.com', 'hotmail.com', 'netplus.ch'])}`
        : `info@${sansAccent(spec.raison ?? 'entreprise').replace(/\./g, '-')}.ch`);
    const ide =
      spec.type === 'entreprise'
        ? `CHE-${String(entre(ctx, 100, 499))}.${String(entre(ctx, 100, 999))}.${String(entre(ctx, 100, 999))}`
        : null;
    const id = await ins(ctx, 'client', {
      numero,
      type: spec.type,
      civilite: spec.civilite ?? null,
      nom: spec.nom ?? null,
      prenom: spec.prenom ?? null,
      raisonSociale: spec.raison ?? null,
      ide,
      langue,
      email,
      telephone: tel.affiche,
      telephoneE164: tel.e164,
      canalPrefere: choisir(ctx, ['email', 'sms', 'telephone']),
      statut: spec.statut ?? 'actif',
      poObligatoire: spec.type === 'entreprise' && ctx.rnd() < 0.3,
      plusAucunContact: spec.plusAucunContact ?? false,
      motif: spec.plusAucunContact ? 'Demande du client : ne plus être contacté' : null,
      origine: 'dfa',
    });
    await ins(ctx, 'client_adresse', {
      clientId: id,
      type: 'principale',
      rue: adr.rue,
      numero: adr.numero,
      npa: adr.npa,
      localite: adr.localite,
      pays: 'CH',
      actif: true,
    });
    if (spec.type === 'entreprise') {
      await ins(ctx, 'client_adresse', {
        clientId: id,
        type: 'facturation',
        rue: adr.rue,
        numero: adr.numero,
        npa: adr.npa,
        localite: adr.localite,
        pays: 'CH',
        actif: true,
      });
    }
    const designation =
      spec.type === 'entreprise'
        ? (spec.raison ?? '')
        : `${spec.prenom ?? ''} ${spec.nom ?? ''}`.trim();
    const c: ClientDemo = {
      id,
      numero,
      type: spec.type,
      designation,
      ide,
      langue,
      adresse: { rue: `${adr.rue} ${adr.numero}`, npa: adr.npa, localite: adr.localite },
      vehicules: [],
    };
    resultat.push(c);
    return c;
  };

  // 30 particuliers
  const particuliers: ClientDemo[] = [];
  for (let i = 0; i < 30; i++) {
    const femme = i % 2 === 0;
    const prenom = choisir(ctx, femme ? PRENOMS_F : PRENOMS_M);
    const nom = NOMS[i % NOMS.length] ?? 'Rey';
    particuliers.push(
      await creer({
        type: 'particulier',
        civilite: femme ? 'Mme' : 'M.',
        nom,
        prenom,
        statut: i === 27 ? 'inactif' : i === 28 ? 'bloque' : 'actif',
        plusAucunContact: i === 29,
      }),
    );
  }
  // Deux paires de doublons probables (même téléphone, même nom, saisie légèrement différente).
  for (const [prenom, nom, prenom2] of [
    ['Nathalie', 'Gaillard', 'Natalie'],
    ['Stéphane', 'Roduit', 'Stephane'],
  ] as const) {
    const tel = telephoneSuisse(ctx);
    particuliers.push(await creer({ type: 'particulier', civilite: 'M.', nom, prenom, tel }));
    particuliers.push(
      await creer({ type: 'particulier', civilite: 'M.', nom, prenom: prenom2, tel }),
    );
  }
  // 11 entreprises
  const entreprises: ClientDemo[] = [];
  for (const [raison] of ENTREPRISES) entreprises.push(await creer({ type: 'entreprise', raison }));

  // Contacts : 1 par particulier sur 3, 2 à 3 par entreprise.
  const rolesEntreprise: string[][] = [
    ['gestionnaire_flotte'],
    ['signataire'],
    ['comptabilite'],
    ['conducteur'],
  ];
  for (const e of entreprises) {
    const nb = entre(ctx, 2, 3);
    for (let k = 0; k < nb; k++) {
      const femme = ctx.rnd() < 0.5;
      const prenom = choisir(ctx, femme ? PRENOMS_F : PRENOMS_M);
      const nom = choisir(ctx, NOMS);
      const tel = telephoneSuisse(ctx);
      await ins(ctx, 'client_contact', {
        clientId: e.id,
        nom,
        prenom,
        fonction: ['Gérant', 'Responsable flotte', 'Comptable', 'Chauffeur'][k] ?? 'Collaborateur',
        telephone: tel.affiche,
        telephoneE164: tel.e164,
        email: `${sansAccent(prenom)}.${sansAccent(nom)}@${sansAccent(e.designation)}.ch`,
        langue: 'fr',
        roles: rolesEntreprise[k] ?? ['conducteur'],
        actif: true,
      });
    }
  }
  for (const [i, p] of particuliers.entries()) {
    if (i % 3 !== 0) continue;
    const tel = telephoneSuisse(ctx);
    await ins(ctx, 'client_contact', {
      clientId: p.id,
      nom: choisir(ctx, NOMS),
      prenom: choisir(ctx, PRENOMS_F),
      fonction: 'Conjoint(e)',
      telephone: tel.affiche,
      telephoneE164: tel.e164,
      langue: 'fr',
      roles: ['conducteur'],
      actif: true,
    });
  }
  // Notes
  const notes: Array<[number, string, string]> = [
    [0, 'interne', 'Préfère être appelée le matin. Ne pas laisser de message sur le fixe.'],
    [
      3,
      'alerte',
      'Litige sur la facture de mars : attendre l’accord de la direction avant tout geste commercial.',
    ],
    [
      5,
      'interne',
      'Véhicule utilisé pour les vacances en montagne : vérifier les pneus d’hiver à chaque passage.',
    ],
    [8, 'interne', 'Client fidèle depuis 2014, apporte aussi les véhicules de ses enfants.'],
    [12, 'alerte', 'Paiement toujours tardif : demander un acompte à l’ouverture de l’OR.'],
    [
      16,
      'interne',
      'Souhaite une voiture de courtoisie à chaque immobilisation de plus d’un jour.',
    ],
  ];
  for (const [idx, nature, texte] of notes) {
    const c = particuliers[idx];
    if (c) await ins(ctx, 'client_note', { clientId: c.id, nature, texte, auteurId: admin });
  }
  await ins(ctx, 'client_note', {
    clientId: entreprises[0]?.id,
    nature: 'interne',
    texte: 'Livraisons tôt le matin : véhicule à préparer la veille.',
    auteurId: admin,
  });
  await ins(ctx, 'client_note', {
    clientId: entreprises[5]?.id,
    nature: 'alerte',
    texte: 'Contrat de service flotte : appliquer le taux horaire FLOTTE.',
    auteurId: admin,
  });
  // Consentements marketing
  for (const [i, p] of particuliers.entries()) {
    if (i % 2 === 0) {
      await ins(ctx, 'client_consentement', {
        clientId: p.id,
        type: 'marketing_email',
        accorde: i % 4 === 0,
        recueilli_le: jour(ctx, -entre(ctx, 30, 400)),
        canal: 'comptoir',
        preuve: { source: 'formulaire papier signé' },
      });
    }
    if (i % 5 === 0) {
      await ins(ctx, 'client_consentement', {
        clientId: p.id,
        type: 'marketing_sms',
        accorde: true,
        recueilli_le: jour(ctx, -entre(ctx, 30, 400)),
        canal: 'web',
        preuve: { source: 'case cochée à la prise de RDV' },
      });
    }
  }
  // Conditions commerciales : flottes
  const taux = ['FLOTTE', 'ATELIER'];
  for (const [i, e] of entreprises.entries()) {
    if (i % 2 !== 0) continue;
    await ins(ctx, 'client_condition', {
      clientId: e.id,
      rabaisMoPourmille: i === 0 ? 100 : 50,
      rabaisPiecesPourmille: 50,
      rabaisPneusPourmille: i === 0 ? 80 : null,
      tauxHoraireCode: taux[i === 0 ? 0 : 1],
      delaiPaiementJours: i === 0 ? 30 : 20,
      modePaiement: 'facture',
      valideDu: '2026-01-01',
    });
  }
  ctx.journaliser(
    `  ${String(resultat.length)} clients (${String(particuliers.length)} particuliers, ${String(entreprises.length)} entreprises), contacts, notes, consentements`,
  );
  return resultat;
}

// ---------------------------------------------------------------------------------------------
// Véhicules
// ---------------------------------------------------------------------------------------------

export async function semerVehicules(ctx: Ctx, clients: ClientDemo[]): Promise<VehiculeDemo[]> {
  const resultat: VehiculeDemo[] = [];
  const plaques = new Set<string>();
  const vins = new Set<string>();
  const existant = await sql<{ valeur: string }>(
    ctx,
    `select valeur from vehicule_plaque where tenant_id = $1`,
    [ctx.tenantId],
  );
  for (const e of existant) plaques.add(e.valeur);

  // Distribution : 1 véhicule pour les particuliers, 3 pour les entreprises (flotte), +1 pour quelques-uns.
  const attributions: ClientDemo[] = [];
  for (const [i, c] of clients.entries()) {
    attributions.push(c);
    if (c.type === 'entreprise') {
      attributions.push(c, c);
      if (i % 2 === 0) attributions.push(c);
    } else if (i % 4 === 0) attributions.push(c);
  }
  const max = 62;
  let compteurExp = 0;
  const admin = ctx.utilisateurs.get('direction') ?? null;

  for (const [index, client] of attributions.slice(0, max).entries()) {
    const m = choisir(ctx, CATALOGUE);
    const annee = entre(ctx, 2013, 2025);
    const mois = entre(ctx, 1, 12);
    const premiere = new Date(Date.UTC(annee, mois - 1, entre(ctx, 1, 28)));
    const ageAns = Math.max(
      0.3,
      (ctx.maintenant.getTime() - premiere.getTime()) / (365.25 * 86400000),
    );
    const km = Math.round((ageAns * entre(ctx, 9000, 17000)) / 100) * 100;
    let vin = '';
    do {
      vin =
        m.code +
        Array.from({ length: 14 }, () => ALPHA_VIN[entre(ctx, 0, ALPHA_VIN.length - 1)]).join('');
    } while (vins.has(vin));
    vins.add(vin);
    const canton = ctx.rnd() < 0.7 ? 'VS' : ctx.rnd() < 0.7 ? 'VD' : 'GE';
    let plaque = '';
    do {
      plaque = `${canton} ${String(entre(ctx, 10000, 999999))}`;
    } while (plaques.has(plaque));
    plaques.add(plaque);

    const vehiculeId = await ins(ctx, 'vehicule', {
      vin,
      marque: m.marque,
      modele: m.modele,
      version: m.version,
      carburant: m.carburant,
      couleur: choisir(ctx, COULEURS),
      date_1re_circulation: iso(premiere),
      cylindreeCm3: m.cm3 || null,
      puissanceKw: m.kw,
      boite: m.boite,
      intervalleEntretienKm: 15000,
      intervalleEntretienMois: 12,
      statut: 'actif',
      origine: 'dfa',
    });
    await ins(ctx, 'vehicule_plaque', {
      vehiculeId,
      valeur: plaque,
      canton,
      pays: 'CH',
      du: iso(premiere),
      au: null,
    });
    const achatDepuis = ajouterJours(premiere, entre(ctx, 0, 60));
    await ins(ctx, 'vehicule_detention', {
      vehiculeId,
      clientId: client.id,
      du: iso(achatDepuis),
      au: null,
    });

    // Kilométrages : trois relevés étalés.
    const releves: Array<[number, number, string]> = [
      [-Math.round(ageAns * 365 * 0.7), Math.round((km * 0.3) / 100) * 100, 'reception'],
      [-entre(ctx, 150, 330), Math.round((km * 0.85) / 100) * 100, 'declaratif'],
      [-entre(ctx, 5, 90), km, 'reception'],
    ];
    for (const [dj, valeur, source] of releves) {
      await ins(ctx, 'vehicule_kilometrage', {
        vehiculeId,
        valeur,
        unite: 'km',
        releveLe: jour(ctx, dj, 10),
        source,
        saisiParId: admin,
      });
    }

    // Expertise MFK : répartition volontaire échues / proches / lointaines.
    if (ageAns >= 3.5 || index % 3 === 0) {
      const motif = compteurExp++ % 10;
      let echeance: Date;
      if (motif === 0) echeance = jour(ctx, -entre(ctx, 10, 140));
      else if (motif <= 2) echeance = jour(ctx, entre(ctx, 3, 28));
      else if (motif === 3) echeance = jour(ctx, entre(ctx, 35, 85));
      else echeance = jour(ctx, entre(ctx, 150, 900));
      const derniere = new Date(
        Date.UTC(
          echeance.getUTCFullYear() - (ageAns > 8 ? 1 : 2),
          echeance.getUTCMonth(),
          Math.min(28, echeance.getUTCDate()),
        ),
      );
      const avecDefauts = motif === 5;
      await ins(ctx, 'vehicule_expertise', {
        vehiculeId,
        dateExpertise: iso(derniere),
        resultat: avecDefauts ? 'accepte_avec_defauts' : 'accepte',
        defauts: avecDefauts
          ? 'Éclairage de plaque défectueux, usure des plaquettes avant à surveiller'
          : null,
        delaiContreVisite: avecDefauts ? iso(ajouterJours(derniere, 60)) : null,
        dateContreVisite: avecDefauts ? iso(ajouterJours(derniere, 20)) : null,
        prochaineEcheance: iso(echeance),
        sourceEcheance: motif % 2 === 0 ? 'calculee' : 'convocation',
      });
    }

    // Travaux reportés (constats sur un passage précédent)
    if (index % 5 === 1) {
      const travaux: Array<[string, string, boolean, number]> = [
        ['Plaquettes de frein arrière à remplacer (usure 70 %)', 'a_faire', true, 38000],
        ['Pneus avant usés (profil 2,5 mm)', 'a_faire', false, 56000],
        ['Fuite d’huile légère au joint de couvre-culbuteur', 'a_surveiller', false, 42000],
        ['Courroie d’accessoires fissurée', 'urgent', true, 21000],
      ];
      const [designation, urgence, securite, montant] =
        travaux[index % travaux.length] ?? (travaux[0] as [string, string, boolean, number]);
      await ins(ctx, 'vehicule_travail_reporte', {
        vehiculeId,
        designation,
        urgence,
        securite,
        montantEstimeCentimes: montant,
        kmConstat: Math.max(0, km - entre(ctx, 800, 4000)),
        dateConstat: iso(jour(ctx, -entre(ctx, 10, 150))),
        statut: 'ouvert',
      });
    }
    // Campagnes constructeur
    if (index % 11 === 4) {
      await ins(ctx, 'vehicule_campagne', {
        vehiculeId,
        code: `${m.marque.slice(0, 3).toUpperCase()}-${String(entre(ctx, 20, 25))}${choisir(ctx, ['R1', 'Q8', 'S4'])}`,
        description: choisir(ctx, [
          'Rappel : mise à jour logiciel du calculateur moteur',
          'Rappel : contrôle de la pompe à carburant',
          'Rappel : remplacement du capteur d’airbag passager',
        ]),
        obligatoire: ctx.rnd() < 0.6,
        statut: 'ouverte',
      });
    }
    if (index % 17 === 6) {
      await ins(ctx, 'vehicule_campagne', {
        vehiculeId,
        code: 'SERV-2024-01',
        description: 'Rappel : kit de fixation de batterie (déjà traité)',
        obligatoire: false,
        statut: 'close',
        closeLe: jour(ctx, -120),
      });
    }

    client.vehicules.push(vehiculeId);
    resultat.push({
      id: vehiculeId,
      clientId: client.id,
      plaque,
      libelle: `${m.marque} ${m.modele}`,
      km,
    });
  }
  ctx.journaliser(
    `  ${String(resultat.length)} véhicules (plaques VS/VD/GE, kilométrages, expertises MFK, campagnes, travaux reportés)`,
  );
  return resultat;
}
