import { peut, type ActionsSession } from '@/droits';

export const peutExporterVersFiduciaire = (a: ActionsSession) =>
  peut(a, 'facturation.export.creer');
