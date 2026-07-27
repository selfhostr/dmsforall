import { Injectable } from '@nestjs/common';

/**
 * Source de temps injectable. Tout code qui a besoin de "maintenant" passe par ici plutôt
 * que par `new Date()` directement, pour rester testable (un test peut fournir un
 * `Horloge` factice à date fixe sans mocker le module `Date` global).
 */
@Injectable()
export class Horloge {
  maintenant(): Date {
    return new Date();
  }
}
