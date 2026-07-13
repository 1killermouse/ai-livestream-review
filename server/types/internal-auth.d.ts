import type { InternalUser } from '@shared/api.interface';

declare global {
  namespace Express {
    interface Request {
      internalUser?: InternalUser;
    }
  }
}

export {};
