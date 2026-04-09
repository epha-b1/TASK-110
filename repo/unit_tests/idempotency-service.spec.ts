/**
 * Unit tests for the idempotency service.
 *
 * These verify the service-level behavior of the (key, actor_id,
 * operation, resource_id) scope — the audit fix for the cross-resource
 * replay hazard. The tests mock the Sequelize Model so they run
 * without a database and are fast/deterministic.
 *
 * What they prove:
 *  - `checkIdempotency` queries with resource_id included
 *  - `storeIdempotency` writes resource_id to the row
 *  - a null resource_id normalises to '' (the sentinel)
 *  - replay → returns stored snapshot when request hash matches
 *  - conflict → throws IDEMPOTENCY_CONFLICT when hash differs
 *  - expiry → deletes the stale row and returns null (proceed)
 */

import { IdempotencyKey, checkIdempotency, storeIdempotency } from '../src/services/idempotency.service';
import { AppError } from '../src/utils/errors';

describe('idempotency service — resource-scoped behavior', () => {
  beforeEach(() => {
    (IdempotencyKey.findOne as jest.Mock).mockReset();
    (IdempotencyKey.create as jest.Mock).mockReset();
    (IdempotencyKey.destroy as jest.Mock).mockReset();
  });

  describe('checkIdempotency', () => {
    test('lookup includes resource_id in the where clause', async () => {
      (IdempotencyKey.findOne as jest.Mock).mockResolvedValueOnce(null);

      const result = await checkIdempotency('K1', 'user-1', 'update_itinerary', 'item-42', { title: 'x' });
      expect(result).toBeNull();

      expect(IdempotencyKey.findOne).toHaveBeenCalledWith({
        where: {
          key: 'K1',
          actor_id: 'user-1',
          operation: 'update_itinerary',
          resource_id: 'item-42',
        },
      });
    });

    test('null resource_id normalises to empty-string sentinel', async () => {
      (IdempotencyKey.findOne as jest.Mock).mockResolvedValueOnce(null);
      await checkIdempotency('K1', 'user-1', 'generic_op', null, {});

      expect(IdempotencyKey.findOne).toHaveBeenCalledWith({
        where: {
          key: 'K1',
          actor_id: 'user-1',
          operation: 'generic_op',
          resource_id: '',
        },
      });
    });

    test('replay — same body hash returns stored snapshot', async () => {
      const body = { title: 'same' };
      // hash calculation is internal so we feed the row an unused hash
      // and override matching by making findOne return the exact hash
      // the service would compute for `body`. Easier: make the stored
      // hash match whatever the service produces by replaying `body` as
      // the stored request.
      const stored = {
        id: 'row-1',
        expires_at: new Date(Date.now() + 60_000),
        request_hash: require('crypto').createHash('sha256').update(JSON.stringify(body)).digest('hex'),
        response_snapshot: { ok: true },
      };
      (IdempotencyKey.findOne as jest.Mock).mockResolvedValueOnce(stored);

      const result = await checkIdempotency('K2', 'u1', 'update_itinerary', 'item-1', body);
      expect(result).toEqual({ ok: true });
    });

    test('conflict — different body hash throws IDEMPOTENCY_CONFLICT', async () => {
      const stored = {
        id: 'row-1',
        expires_at: new Date(Date.now() + 60_000),
        request_hash: 'some-other-hash-that-does-not-match',
        response_snapshot: { ok: true },
      };
      (IdempotencyKey.findOne as jest.Mock).mockResolvedValueOnce(stored);

      let caught: unknown;
      try {
        await checkIdempotency('K3', 'u1', 'update_itinerary', 'item-1', { title: 'new' });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(AppError);
      expect((caught as AppError).statusCode).toBe(409);
      expect((caught as AppError).code).toBe('IDEMPOTENCY_CONFLICT');
    });

    test('expired row is destroyed and caller proceeds', async () => {
      const stored = {
        id: 'row-expired',
        expires_at: new Date(Date.now() - 60_000),
        request_hash: 'anything',
        response_snapshot: null,
      };
      (IdempotencyKey.findOne as jest.Mock).mockResolvedValueOnce(stored);
      (IdempotencyKey.destroy as jest.Mock).mockResolvedValueOnce(1);

      const result = await checkIdempotency('K4', 'u1', 'update_itinerary', 'item-1', {});
      expect(result).toBeNull();
      expect(IdempotencyKey.destroy).toHaveBeenCalledWith({ where: { id: 'row-expired' } });
    });
  });

  describe('storeIdempotency', () => {
    test('persists resource_id alongside key/actor/operation', async () => {
      (IdempotencyKey.create as jest.Mock).mockResolvedValueOnce({});

      await storeIdempotency('K5', 'u1', 'update_itinerary', 'item-99', { foo: 1 }, { out: true });

      expect(IdempotencyKey.create).toHaveBeenCalledTimes(1);
      const arg = (IdempotencyKey.create as jest.Mock).mock.calls[0][0];
      expect(arg).toMatchObject({
        key: 'K5',
        actor_id: 'u1',
        operation: 'update_itinerary',
        resource_id: 'item-99',
      });
      expect(arg.response_snapshot).toEqual({ out: true });
      expect(typeof arg.request_hash).toBe('string');
      expect(arg.request_hash).toHaveLength(64); // sha256 hex
    });

    test('null resource_id persists as empty-string sentinel', async () => {
      (IdempotencyKey.create as jest.Mock).mockResolvedValueOnce({});
      await storeIdempotency('K6', 'u1', 'generic_op', null, {}, null);

      const arg = (IdempotencyKey.create as jest.Mock).mock.calls[0][0];
      expect(arg.resource_id).toBe('');
    });
  });
});
