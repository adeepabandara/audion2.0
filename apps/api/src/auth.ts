import { TOKEN_TTL_SEC } from '@audion/shared';
import { jwtVerify, SignJWT } from 'jose';
import { AppError } from './errors.js';

const ISSUER = 'audion-api';

export async function issueToken(
  installId: string,
  secret: string,
): Promise<{ token: string; expiresInSec: number }> {
  const key = new TextEncoder().encode(secret);
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(installId)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SEC}s`)
    .sign(key);
  return { token, expiresInSec: TOKEN_TTL_SEC };
}

/** Returns the install ID the token was issued to. */
export async function verifyToken(header: string | undefined, secret: string): Promise<string> {
  const match = header?.match(/^Bearer (.+)$/);
  if (!match?.[1]) throw new AppError('UNAUTHENTICATED', 'Missing bearer token.');
  try {
    const { payload } = await jwtVerify(match[1], new TextEncoder().encode(secret), {
      issuer: ISSUER,
      algorithms: ['HS256'],
    });
    if (!payload.sub) throw new Error('no subject');
    return payload.sub;
  } catch {
    throw new AppError('UNAUTHENTICATED', 'Invalid or expired token.');
  }
}
