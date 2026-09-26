import { verifyCompleteSmoke } from './verify-complete-smoke.mjs';
import { verifyBasicSmoke } from './verify-basic-smoke.mjs';

export async function verifySelectedEdition(app, page) {
  const edition = process.env.INSOMNIA_OFFLINE_EDITION || 'full';
  if (edition === 'basic') return verifyBasicSmoke(app, page);
  if (edition === 'full') return verifyCompleteSmoke(app, page);
  throw new Error('Unsupported offline edition');
}
