// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * COSE_Key encoding for the ES256 public keys this authenticator issues.
 */

import { encodeCbor, type CborValue } from "./cbor.js";

export const COSE_ALG_ES256 = -7;

const COSE_KTY_EC2 = 2;
const COSE_CRV_P256 = 1;

export interface P256Coordinates {
  x: Uint8Array;
  y: Uint8Array;
}

export function toCoseKey({ x, y }: P256Coordinates): Uint8Array {
  return encodeCbor(
    new Map<number | string, CborValue>([
      [1, COSE_KTY_EC2],
      [3, COSE_ALG_ES256],
      [-1, COSE_CRV_P256],
      [-2, x],
      [-3, y],
    ]),
  );
}
