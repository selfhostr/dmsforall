import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { ProblemeDetailCommunDto } from './probleme-detail.dto';

/**
 * Déclare une réponse d'erreur `application/problem+json` typée sur un endpoint Swagger.
 * À poser pour chaque code d'erreur possible d'un endpoint (voir tableau §4 du contrat) —
 * le front génère ses types depuis ce document, une réponse d'erreur non déclarée n'existe
 * pas pour lui.
 */
export const ApiReponseProbleme = (status: number, description: string): MethodDecorator =>
  applyDecorators(ApiResponse({ status, description, type: ProblemeDetailCommunDto }));
