import { createHash } from 'node:crypto';

/**
 * HSM/KMS signer interface (BE-STEPUP-006, BE-DOD-002): the ONLY code path
 * allowed to produce a STEP_UP_ATTESTER signature. The private key never
 * leaves the implementation; MockKmsSigner is the test double.
 */
export class MockKmsSigner {
  constructor(privateKey) {
    this.privateKey = privateKey;
    this.attesterAddress =
      '0x' + createHash('sha256').update(privateKey.slice(2)).digest('hex').slice(0, 40);
  }

  async signDigest(digest) {
    const { privateKeyToAccount } = await import('viem/accounts');
    const account = privateKeyToAccount(this.privateKey);
    const sig = await account.sign({ hash: digest }); // signs the raw digest
    // viem returns the signature as 65-byte hex (r || s || v).
    if (typeof sig === 'string') {
      const body = sig.slice(2);
      const r = BigInt('0x' + body.slice(0, 64));
      const s = BigInt('0x' + body.slice(64, 128));
      const v = parseInt(body.slice(128, 130), 16);
      return { r, s, v };
    }
    const v = sig.v ?? sig.yParity + 27;
    return { r: BigInt(sig.r), s: BigInt(sig.s), v };
  }
}
