import { peut, type ActionsSession } from '@/droits';

export const peutLireDossierVente = (a: ActionsSession) => peut(a, 'ventes.dossier.lire');
export const peutEcrireDossierVente = (a: ActionsSession) => peut(a, 'ventes.dossier.creer');
