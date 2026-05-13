/** Tiny collision-resistant ID generator — avoids a dependency on the `nanoid` npm package */
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function nanoid(length = 12): string {
  let id = '';
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  for (const byte of array) {
    id += ALPHABET[byte % ALPHABET.length];
  }
  return id;
}
