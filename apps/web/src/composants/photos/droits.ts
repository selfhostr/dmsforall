import { peut, type ActionsSession } from '@/droits';

export const peutAjouterPhoto = (a: ActionsSession) => peut(a, 'atelier.ligne.photo.ajouter');
