import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../config/database';
import { AppError } from '../utils/errors';

/**
 * Idempotency key store for update-style operations.
 *
 * The uniqueness scope is:
 *
 *     (key, actor_id, operation, resource_id)
 *
 * Including `resource_id` fixes the audit finding that the previous
 * `(key, actor_id, operation)` scope caused cross-resource collisions:
 * an actor updating resource A with key K then updating resource B
 * with the SAME key K (different request) would either be rejected as
 * a bogus 409 or, worse, replay resource A's stored response against
 * resource B. Neither is correct.
 *
 * `resource_id` is stored as a NOT NULL string (default `''`) because
 * MySQL unique indexes allow multiple NULLs, which would quietly
 * defeat the scope for operations that have no concrete resource
 * target (`''` is the canonical "no target" marker — callers for
 * resource-less operations should pass `null` and the helper below
 * normalises it to `''`).
 *
 * See also:
 *   - migrations/019-idempotency-scope-by-resource.js
 */

export class IdempotencyKey extends Model {
  public id!: string;
  public key!: string;
  public actor_id!: string;
  public operation!: string;
  public resource_id!: string;
  public request_hash!: string;
  public response_snapshot!: unknown;
  public expires_at!: Date;
  public created_at!: Date;
}

IdempotencyKey.init({
  id: { type: DataTypes.STRING(36), primaryKey: true },
  key: { type: DataTypes.STRING(255), allowNull: false },
  actor_id: { type: DataTypes.STRING(36), allowNull: false },
  operation: { type: DataTypes.STRING(100), allowNull: false },
  // Non-null so the composite unique index below actually guarantees
  // uniqueness — MySQL permits multiple NULLs in a UNIQUE index, which
  // would let the same (key, actor, op) reach two rows with different
  // "no-target" operations. `''` is the sentinel for "no resource".
  resource_id: { type: DataTypes.STRING(255), allowNull: false, defaultValue: '' },
  request_hash: { type: DataTypes.STRING(64), allowNull: false },
  response_snapshot: { type: DataTypes.JSON, allowNull: true },
  expires_at: { type: DataTypes.DATE, allowNull: false },
  created_at: { type: DataTypes.DATE, allowNull: false },
}, {
  sequelize,
  tableName: 'idempotency_keys',
  timestamps: false,
  underscored: true,
  indexes: [
    {
      name: 'idx_idemp_key_actor_op_res',
      unique: true,
      fields: ['key', 'actor_id', 'operation', 'resource_id'],
    },
  ],
});

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function hashBody(body: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(body || {})).digest('hex');
}

/**
 * Normalize a caller-supplied resource id to the canonical sentinel
 * when absent. Treat `null`, `undefined`, and `''` identically so the
 * database row and the lookup query always agree.
 */
function normalizeResourceId(resourceId: string | null | undefined): string {
  return resourceId == null ? '' : resourceId;
}

/**
 * Check idempotency for an update operation.
 *
 * Scope: `(key, actor_id, operation, resource_id)`.
 *
 * Returns the stored response if the same actor already used the key
 * against the same resource with an identical request body (replay).
 * Returns null to indicate the caller should proceed with the real
 * mutation. Throws 409 when the scope matches but the body differs —
 * that means the key was reused for a different payload and silently
 * accepting the new body would lose data.
 *
 * IMPORTANT: callers MUST pass `resourceId` so the scope includes it.
 * Pass `null` for operations with no concrete resource target; it will
 * be normalized to the `''` sentinel.
 */
export async function checkIdempotency(
  key: string,
  actorId: string,
  operation: string,
  resourceId: string | null,
  body: unknown
): Promise<unknown | null> {
  const resId = normalizeResourceId(resourceId);
  const existing = await IdempotencyKey.findOne({
    where: { key, actor_id: actorId, operation, resource_id: resId },
  });
  if (!existing) return null; // proceed

  if (new Date(existing.expires_at) < new Date()) {
    // Expired — delete and proceed
    await IdempotencyKey.destroy({ where: { id: existing.id } });
    return null;
  }

  const reqHash = hashBody(body);
  if (existing.request_hash === reqHash) {
    // Same request — return stored response (replay)
    return existing.response_snapshot;
  }

  // Different body with same key — conflict
  throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key already used with a different request');
}

/**
 * Store the response for an idempotent operation.
 *
 * Scope is the same composite as `checkIdempotency`. Passing the same
 * `resourceId` for both calls is the caller's responsibility.
 */
export async function storeIdempotency(
  key: string,
  actorId: string,
  operation: string,
  resourceId: string | null,
  body: unknown,
  response: unknown
): Promise<void> {
  await IdempotencyKey.create({
    id: uuidv4(),
    key,
    actor_id: actorId,
    operation,
    resource_id: normalizeResourceId(resourceId),
    request_hash: hashBody(body),
    response_snapshot: response,
    expires_at: new Date(Date.now() + TTL_MS),
    created_at: new Date(),
  });
}
