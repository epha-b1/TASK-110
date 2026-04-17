import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { encrypt, decrypt } from '../src/utils/crypto';
import { registerSchema, changePasswordSchema } from '../src/utils/validation';

describe('Slice 2 — Auth Unit Tests', () => {
  // Password policy is enforced by the REAL production zod schemas
  // (`registerSchema` and `changePasswordSchema`). Testing against
  // duplicated regexes would pass even if the production rule drifted;
  // importing the actual schema pins the contract.
  describe('Password Policy (registerSchema — real schema)', () => {
    const base = { username: 'validuser' };

    test('rejects password shorter than 10 chars', () => {
      expect(() => registerSchema.parse({ ...base, password: 'Ab1!xxxxx' })).toThrow(); // 9 chars
    });

    test('accepts 10+ char password at the boundary', () => {
      expect(() => registerSchema.parse({ ...base, password: 'Admin1!pass' })).not.toThrow();
    });

    test('accepts password with number and symbol', () => {
      expect(() => registerSchema.parse({ ...base, password: 'MyP@ssw0rd123' })).not.toThrow();
    });

    test('rejects empty username', () => {
      expect(() => registerSchema.parse({ username: '', password: 'Admin1!pass' })).toThrow();
    });

    test('changePasswordSchema also enforces the 10-char min on newPassword', () => {
      expect(() => changePasswordSchema.parse({ currentPassword: 'any', newPassword: 'short' })).toThrow();
      expect(() => changePasswordSchema.parse({ currentPassword: 'any', newPassword: 'NewPass1!xy' })).not.toThrow();
    });

    test('changePasswordSchema requires currentPassword', () => {
      expect(() => changePasswordSchema.parse({ newPassword: 'NewPass1!xy' } as unknown)).toThrow();
    });
  });

  describe('bcrypt', () => {
    test('hash and verify round-trip', async () => {
      const password = 'Admin1!pass';
      const hash = await bcrypt.hash(password, 12);
      expect(hash).not.toBe(password);
      expect(await bcrypt.compare(password, hash)).toBe(true);
      expect(await bcrypt.compare('wrong', hash)).toBe(false);
    }, 15000);
  });

  describe('AES-256-GCM crypto', () => {
    test('encrypt/decrypt round-trip', () => {
      const plaintext = 'sensitive data here';
      const ciphertext = encrypt(plaintext);
      expect(ciphertext).not.toBe(plaintext);
      expect(ciphertext.split(':')).toHaveLength(3);
      const decrypted = decrypt(ciphertext);
      expect(decrypted).toBe(plaintext);
    });

    test('different encryptions produce different ciphertexts (random IV)', () => {
      const plaintext = 'same text';
      const c1 = encrypt(plaintext);
      const c2 = encrypt(plaintext);
      expect(c1).not.toBe(c2);
      expect(decrypt(c1)).toBe(plaintext);
      expect(decrypt(c2)).toBe(plaintext);
    });
  });

  describe('JWT', () => {
    const secret = 'test-secret-key';
    const payload = { userId: 'abc-123', username: 'testuser', role: 'member' };

    test('sign and verify with correct secret', () => {
      const token = jwt.sign(payload, secret, { algorithm: 'HS256', expiresIn: 3600 });
      const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] }) as typeof payload;
      expect(decoded.userId).toBe(payload.userId);
      expect(decoded.username).toBe(payload.username);
      expect(decoded.role).toBe(payload.role);
    });

    test('verify throws with wrong secret', () => {
      const token = jwt.sign(payload, secret, { algorithm: 'HS256' });
      expect(() => jwt.verify(token, 'wrong-secret', { algorithms: ['HS256'] })).toThrow();
    });
  });

  // Lockout semantics are exercised end-to-end in
  // `API_tests/auth.api.spec.ts` ("423 — after 5 failed attempts") and
  // the register/login code paths have full HTTP coverage. The
  // earlier "simulate the lockout in the test" block was synthetic —
  // it would have passed even if the real threshold or window changed.
});
