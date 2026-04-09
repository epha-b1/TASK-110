'use strict';

/**
 * Fix cross-tenant idempotency isolation for itinerary creation.
 *
 * Original schema had a global UNIQUE constraint on
 * `itinerary_items.idempotency_key`, which means an idempotency key
 * coined by user A in group G1 could collide with — or, worse, return
 * the wrong row to — a request from user B in group G2 that happened
 * to use the same key. The audit flagged this as a tenant-isolation
 * defect.
 *
 * Fix: replace the global unique with a composite unique on
 *   (group_id, created_by, idempotency_key)
 *
 * This is the strictest scope that still preserves correct replay
 * semantics for the same caller (same user, same group, same key →
 * same row). Different group OR different user → different rows even
 * if the key string happens to match.
 *
 * The accompanying service change in src/services/itinerary.service.ts
 * also matches by all three columns when looking up an existing item,
 * so the unique index and the lookup query agree.
 *
 * Down: restore the original (incorrect) global unique. Only intended
 * for dev rollback — production should never run the down path.
 */
module.exports = {
  async up(queryInterface) {
    // Drop the global UNIQUE on idempotency_key. Sequelize names auto
    // unique indexes after the column; the explicit name set in
    // migration 007 was `idempotency_key` (the implicit form). Some
    // MySQL servers expose it under either name, so try both and
    // ignore "doesn't exist" errors.
    for (const name of ['idempotency_key', 'itinerary_items_idempotency_key']) {
      try { await queryInterface.removeIndex('itinerary_items', name); } catch { /* not present */ }
    }
    // Also drop the non-unique index added in migration 007 if it
    // exists, since the new composite index covers the same use cases.
    try { await queryInterface.removeIndex('itinerary_items', ['idempotency_key']); } catch { /* not present */ }

    await queryInterface.addIndex('itinerary_items', ['group_id', 'created_by', 'idempotency_key'], {
      unique: true,
      name: 'idx_itinerary_items_scope_idempotency',
    });
  },

  async down(queryInterface, Sequelize) {
    try {
      await queryInterface.removeIndex('itinerary_items', 'idx_itinerary_items_scope_idempotency');
    } catch { /* not present */ }
    // Restore original (incorrect) global unique for dev rollback.
    await queryInterface.addIndex('itinerary_items', ['idempotency_key'], {
      unique: true,
      name: 'idempotency_key',
    });
  },
};
