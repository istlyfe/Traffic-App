import * as Crypto from 'expo-crypto';

/** RFC 4122 v4 UUID generated with the platform CSPRNG. */
export function newUuid(): string {
  return Crypto.randomUUID();
}
