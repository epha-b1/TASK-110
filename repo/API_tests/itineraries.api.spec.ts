import request from 'supertest';
import app from '../src/app';
import { sequelize } from '../src/config/database';
import { describeDb } from './db-guard';

let adminToken: string;
let memberToken: string;
let groupId: string;
let itemId: string;
let checkpointId: string;
const RUN_ID = Date.now();

describeDb('Slice 5 — Itineraries API', () => {
  beforeAll(async () => {
    await sequelize.authenticate();
    const a = await request(app).post('/auth/login').send({ username: 'admin', password: 'Admin1!pass' });
    adminToken = a.body.accessToken;
    const m = await request(app).post('/auth/login').send({ username: 'member1', password: 'Member1!pass' });
    memberToken = m.body.accessToken;

    // Create a group and have member join
    const g = await request(app).post('/groups').set('Authorization', `Bearer ${adminToken}`).send({ name: 'Itin Test Group' });
    groupId = g.body.id;
    await request(app).post('/groups/join').set('Authorization', `Bearer ${memberToken}`).send({ joinCode: g.body.join_code });
  });

  afterAll(async () => { await sequelize.close(); });

  test('POST create item 201', async () => {
    const res = await request(app).post(`/groups/${groupId}/itineraries`).set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Morning Hike', meetupDate: '12/25/2025', meetupTime: '9:30 AM', meetupLocation: 'Lobby', notes: 'Bring water', idempotencyKey: `itin-create-${RUN_ID}` });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Morning Hike');
    itemId = res.body.id;
  });

  test('POST create — idempotency returns same item', async () => {
    const res = await request(app).post(`/groups/${groupId}/itineraries`).set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Morning Hike', meetupDate: '12/25/2025', meetupTime: '9:30 AM', meetupLocation: 'Lobby', idempotencyKey: `itin-create-${RUN_ID}` });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(itemId);
  });

  test('POST create 400 — bad date format', async () => {
    const res = await request(app).post(`/groups/${groupId}/itineraries`).set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Bad', meetupDate: '2025-12-25', meetupTime: '9:30 AM', meetupLocation: 'X', idempotencyKey: 'bad-date' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  test('POST create 400 — missing required field (title)', async () => {
    const res = await request(app).post(`/groups/${groupId}/itineraries`).set('Authorization', `Bearer ${adminToken}`)
      .send({ meetupDate: '12/25/2025', meetupTime: '9:30 AM', meetupLocation: 'X', idempotencyKey: 'no-title' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  test('POST create 400 — strict schema rejects unknown field', async () => {
    const res = await request(app).post(`/groups/${groupId}/itineraries`).set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'X', meetupDate: '12/25/2025', meetupTime: '9:30 AM',
        meetupLocation: 'X', idempotencyKey: 'unk', unknownField: 'leak',
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  test('POST create 400 — bad time format', async () => {
    const res = await request(app).post(`/groups/${groupId}/itineraries`).set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Bad', meetupDate: '12/25/2025', meetupTime: '13:00', meetupLocation: 'X', idempotencyKey: 'bad-time' });
    expect(res.status).toBe(400);
  });

  test('POST create 400 — notes too long', async () => {
    const res = await request(app).post(`/groups/${groupId}/itineraries`).set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Long', meetupDate: '12/25/2025', meetupTime: '9:30 AM', meetupLocation: 'X', notes: 'x'.repeat(2001), idempotencyKey: 'long-notes' });
    expect(res.status).toBe(400);
  });

  test('GET list items 200', async () => {
    const res = await request(app).get(`/groups/${groupId}/itineraries`).set('Authorization', `Bearer ${memberToken}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  test('GET single item 200', async () => {
    const res = await request(app).get(`/groups/${groupId}/itineraries/${itemId}`).set('Authorization', `Bearer ${memberToken}`);
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Morning Hike');
  });

  test('PATCH update item 200', async () => {
    const res = await request(app).patch(`/groups/${groupId}/itineraries/${itemId}`).set('Authorization', `Bearer ${memberToken}`)
      .send({ title: 'Evening Hike', idempotencyKey: `itin-update-${RUN_ID}` });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Evening Hike');
  });

  test('PATCH update — same idempotency key + same body replays response', async () => {
    const res = await request(app).patch(`/groups/${groupId}/itineraries/${itemId}`).set('Authorization', `Bearer ${memberToken}`)
      .send({ title: 'Evening Hike', idempotencyKey: `itin-update-${RUN_ID}` });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Evening Hike');
  });

  test('PATCH update — same key + different body = 409 conflict', async () => {
    const res = await request(app).patch(`/groups/${groupId}/itineraries/${itemId}`).set('Authorization', `Bearer ${memberToken}`)
      .send({ title: 'DIFFERENT TITLE', idempotencyKey: `itin-update-${RUN_ID}` });
    expect(res.status).toBe(409);
  });

  test('POST add checkpoint 201', async () => {
    const res = await request(app).post(`/groups/${groupId}/itineraries/${itemId}/checkpoints`).set('Authorization', `Bearer ${adminToken}`)
      .send({ label: 'Trailhead', position: 1, description: 'Start here' });
    expect(res.status).toBe(201);
    checkpointId = res.body.id;
  });

  test('POST add checkpoint 400 — position out of range (zod)', async () => {
    const res = await request(app).post(`/groups/${groupId}/itineraries/${itemId}/checkpoints`).set('Authorization', `Bearer ${adminToken}`)
      .send({ label: 'Bad', position: 99 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  test('POST add checkpoint 400 — missing label (zod)', async () => {
    const res = await request(app).post(`/groups/${groupId}/itineraries/${itemId}/checkpoints`).set('Authorization', `Bearer ${adminToken}`)
      .send({ position: 2 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  test('POST add checkpoint 400 — strict schema rejects unknown field', async () => {
    const res = await request(app).post(`/groups/${groupId}/itineraries/${itemId}/checkpoints`).set('Authorization', `Bearer ${adminToken}`)
      .send({ label: 'X', position: 3, secretInjection: '<script>' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  test('GET list checkpoints 200', async () => {
    const res = await request(app).get(`/groups/${groupId}/itineraries/${itemId}/checkpoints`).set('Authorization', `Bearer ${memberToken}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
  });

  test('PATCH update checkpoint 200', async () => {
    const res = await request(app).patch(`/groups/${groupId}/itineraries/${itemId}/checkpoints/${checkpointId}`).set('Authorization', `Bearer ${memberToken}`)
      .send({ label: 'Updated Trailhead' });
    expect(res.status).toBe(200);
    expect(res.body.label).toBe('Updated Trailhead');
  });

  test('POST checkin 200 — no required fields', async () => {
    const res = await request(app).post(`/groups/${groupId}/itineraries/${itemId}/checkin`).set('Authorization', `Bearer ${memberToken}`);
    expect(res.status).toBe(200);
  });

  test('POST checkin 400 — missing required fields', async () => {
    // Add a required field
    await request(app).post(`/groups/${groupId}/required-fields`).set('Authorization', `Bearer ${adminToken}`)
      .send({ fieldName: 'badge_number', fieldType: 'text', isRequired: true });

    // Create a new item to checkin to
    const newItem = await request(app).post(`/groups/${groupId}/itineraries`).set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Require Fields Test', meetupDate: '01/01/2026', meetupTime: '8:00 AM', meetupLocation: 'Gate', idempotencyKey: `checkin-req-${RUN_ID}` });

    const res = await request(app).post(`/groups/${groupId}/itineraries/${newItem.body.id}/checkin`).set('Authorization', `Bearer ${memberToken}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MISSING_REQUIRED_FIELDS');
  });

  test('DELETE item 204 — owner only', async () => {
    const tempItem = await request(app).post(`/groups/${groupId}/itineraries`).set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Delete Me', meetupDate: '01/01/2026', meetupTime: '10:00 AM', meetupLocation: 'X', idempotencyKey: `del-item-${RUN_ID}` });
    const res = await request(app).delete(`/groups/${groupId}/itineraries/${tempItem.body.id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(204);
  });

  test('DELETE item 403 — member cannot delete', async () => {
    const res = await request(app).delete(`/groups/${groupId}/itineraries/${itemId}`).set('Authorization', `Bearer ${memberToken}`);
    expect(res.status).toBe(403);
  });

  test('403 — non-member cannot access', async () => {
    const reg = await request(app).post('/auth/register').send({ username: `outsider2_${Date.now()}`, password: 'Outsider1!xx' });
    const login = await request(app).post('/auth/login').send({ username: reg.body.username, password: 'Outsider1!xx' });
    const res = await request(app).get(`/groups/${groupId}/itineraries`).set('Authorization', `Bearer ${login.body.accessToken}`);
    expect(res.status).toBe(403);
  });

  test('POST checkpoint 409 — duplicate position conflict', async () => {
    const res = await request(app).post(`/groups/${groupId}/itineraries/${itemId}/checkpoints`).set('Authorization', `Bearer ${adminToken}`)
      .send({ label: 'Duplicate Pos', position: 1 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CONFLICT');
  });

  // ─── Cross-tenant idempotency isolation (audit fix) ─────────────────
  describe('Idempotency scoping — cross-tenant isolation', () => {
    test('same key in DIFFERENT groups → distinct items, no replay leak', async () => {
      const sharedKey = `cross-group-key-${RUN_ID}`;

      // Group A: admin creates an item with `sharedKey`
      const gA = await request(app).post('/groups')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `Iso A ${RUN_ID}` });
      const groupAId: string = gA.body.id;

      const itemA = await request(app)
        .post(`/groups/${groupAId}/itineraries`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: 'Item in group A',
          meetupDate: '06/01/2026',
          meetupTime: '9:00 AM',
          meetupLocation: 'Lobby A',
          idempotencyKey: sharedKey,
        });
      expect(itemA.status).toBe(201);
      expect(itemA.body.title).toBe('Item in group A');

      // Group B: same admin reuses the key with a DIFFERENT body. The
      // global-unique bug would make this either replay group A's row
      // (returning the wrong title) or 409. The fix returns a fresh
      // row with the new title.
      const gB = await request(app).post('/groups')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `Iso B ${RUN_ID}` });
      const groupBId: string = gB.body.id;

      const itemB = await request(app)
        .post(`/groups/${groupBId}/itineraries`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: 'Item in group B',
          meetupDate: '07/01/2026',
          meetupTime: '10:00 AM',
          meetupLocation: 'Lobby B',
          idempotencyKey: sharedKey,
        });
      expect(itemB.status).toBe(201);
      expect(itemB.body.title).toBe('Item in group B');
      expect(itemB.body.id).not.toBe(itemA.body.id);
      expect(itemB.body.group_id).toBe(groupBId);
    });

    test('same key, same group, DIFFERENT users → distinct items, no replay leak', async () => {
      // Set up a single group with two members
      const g = await request(app).post('/groups')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `Iso Cross-User ${RUN_ID}` });
      const isoGroupId: string = g.body.id;
      await request(app).post('/groups/join')
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ joinCode: g.body.join_code });

      const sharedKey = `cross-user-key-${RUN_ID}`;

      // Admin creates first
      const adminItem = await request(app)
        .post(`/groups/${isoGroupId}/itineraries`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: 'Admin item',
          meetupDate: '03/01/2026',
          meetupTime: '8:00 AM',
          meetupLocation: 'Loc A',
          idempotencyKey: sharedKey,
        });
      expect(adminItem.status).toBe(201);

      // Member uses same key in same group → should NOT replay admin's item
      const memberItem = await request(app)
        .post(`/groups/${isoGroupId}/itineraries`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({
          title: 'Member item',
          meetupDate: '03/02/2026',
          meetupTime: '9:00 AM',
          meetupLocation: 'Loc B',
          idempotencyKey: sharedKey,
        });
      expect(memberItem.status).toBe(201);
      expect(memberItem.body.title).toBe('Member item');
      expect(memberItem.body.id).not.toBe(adminItem.body.id);
      expect(memberItem.body.created_by).not.toBe(adminItem.body.created_by);
    });

    test('same key + same scope + SAME body → idempotent replay', async () => {
      const g = await request(app).post('/groups')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `Iso Replay ${RUN_ID}` });
      const replayGroupId: string = g.body.id;
      const replayKey = `replay-key-${RUN_ID}`;

      const body = {
        title: 'Replay item',
        meetupDate: '04/01/2026',
        meetupTime: '8:00 AM',
        meetupLocation: 'Lobby',
        idempotencyKey: replayKey,
      };

      const first = await request(app)
        .post(`/groups/${replayGroupId}/itineraries`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(body);
      expect(first.status).toBe(201);

      const second = await request(app)
        .post(`/groups/${replayGroupId}/itineraries`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(body);
      expect(second.status).toBe(201);
      expect(second.body.id).toBe(first.body.id);
    });

    test('same key + same scope + DIFFERENT body → 409 IDEMPOTENCY_CONFLICT', async () => {
      const g = await request(app).post('/groups')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `Iso Conflict ${RUN_ID}` });
      const conflictGroupId: string = g.body.id;
      const conflictKey = `conflict-key-${RUN_ID}`;

      const first = await request(app)
        .post(`/groups/${conflictGroupId}/itineraries`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: 'Original',
          meetupDate: '05/01/2026',
          meetupTime: '8:00 AM',
          meetupLocation: 'Lobby',
          idempotencyKey: conflictKey,
        });
      expect(first.status).toBe(201);

      const conflict = await request(app)
        .post(`/groups/${conflictGroupId}/itineraries`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: 'Different title',
          meetupDate: '05/01/2026',
          meetupTime: '8:00 AM',
          meetupLocation: 'Lobby',
          idempotencyKey: conflictKey,
        });
      expect(conflict.status).toBe(409);
      expect(conflict.body.code).toBe('IDEMPOTENCY_CONFLICT');
    });

    // Combined-axes negative test asked for in the final hardening
    // pass: key reused across BOTH a different user AND a different
    // group AND with a different payload. Three independent rows must
    // result, none of which leak data from any of the others.
    test('different user + different group + different payload → 3 distinct rows, no replay leak', async () => {
      const sharedKey = `triple-axis-${RUN_ID}`;

      // ── Setup: 3 isolated groups ────────────────────────────────
      const gA = await request(app).post('/groups')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `Triple A ${RUN_ID}` });
      const gB = await request(app).post('/groups')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `Triple B ${RUN_ID}` });
      const gC = await request(app).post('/groups')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `Triple C ${RUN_ID}` });

      // member1 joins group B so we can post under their identity
      await request(app).post('/groups/join')
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ joinCode: gB.body.join_code });

      // Create a third user (outsider) and have them join group C
      const outsiderRes = await request(app).post('/auth/register')
        .send({ username: `triple_outsider_${RUN_ID}`, password: 'Outsider1!xx' });
      const outsiderLogin = await request(app).post('/auth/login')
        .send({ username: outsiderRes.body.username, password: 'Outsider1!xx' });
      const outsiderToken = outsiderLogin.body.accessToken;
      await request(app).post('/groups/join')
        .set('Authorization', `Bearer ${outsiderToken}`)
        .send({ joinCode: gC.body.join_code });

      // ── Three POSTs: distinct user, group, and payload ───────────
      const itemA = await request(app)
        .post(`/groups/${gA.body.id}/itineraries`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: 'A — admin',
          meetupDate: '08/01/2026',
          meetupTime: '8:00 AM',
          meetupLocation: 'A-Lobby',
          notes: 'admin notes A',
          idempotencyKey: sharedKey,
        });
      expect(itemA.status).toBe(201);

      const itemB = await request(app)
        .post(`/groups/${gB.body.id}/itineraries`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({
          title: 'B — member',
          meetupDate: '08/02/2026',
          meetupTime: '9:00 AM',
          meetupLocation: 'B-Lobby',
          notes: 'member notes B',
          idempotencyKey: sharedKey,
        });
      expect(itemB.status).toBe(201);

      const itemC = await request(app)
        .post(`/groups/${gC.body.id}/itineraries`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .send({
          title: 'C — outsider',
          meetupDate: '08/03/2026',
          meetupTime: '10:00 AM',
          meetupLocation: 'C-Lobby',
          notes: 'outsider notes C',
          idempotencyKey: sharedKey,
        });
      expect(itemC.status).toBe(201);

      // All three IDs distinct
      expect(new Set([itemA.body.id, itemB.body.id, itemC.body.id]).size).toBe(3);

      // Each row carries its own group_id and created_by
      expect(itemA.body.group_id).toBe(gA.body.id);
      expect(itemB.body.group_id).toBe(gB.body.id);
      expect(itemC.body.group_id).toBe(gC.body.id);

      expect(itemA.body.created_by).not.toBe(itemB.body.created_by);
      expect(itemA.body.created_by).not.toBe(itemC.body.created_by);
      expect(itemB.body.created_by).not.toBe(itemC.body.created_by);

      // Each row carries its own payload — no foreign data leak
      expect(itemA.body.title).toBe('A — admin');
      expect(itemB.body.title).toBe('B — member');
      expect(itemC.body.title).toBe('C — outsider');
      expect(itemA.body.notes).toBe('admin notes A');
      expect(itemB.body.notes).toBe('member notes B');
      expect(itemC.body.notes).toBe('outsider notes C');
    });
  });

  // ─── Update idempotency scoping — per-resource isolation (audit fix) ─
  //
  // Previously the update flow scoped idempotency by (key, actor_id,
  // operation) — it did not include the itinerary item id. That meant
  // the same actor reusing the same key to update a DIFFERENT item
  // either (a) hit the unique index and failed, or (b) matched the
  // earlier item's stored response and replayed it against the wrong
  // resource. Fixed by adding resource_id to both the index and the
  // service lookup (see migration 019 and idempotency.service.ts).
  describe('Update idempotency scoping — cross-resource isolation', () => {
    test('same key used to update TWO DIFFERENT items → both updates succeed independently', async () => {
      const g = await request(app).post('/groups')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `Update Iso ${RUN_ID}` });
      const isoGroupId: string = g.body.id;

      // Create two distinct items in the same group under admin
      const itemOne = await request(app)
        .post(`/groups/${isoGroupId}/itineraries`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: 'Item One',
          meetupDate: '09/01/2026', meetupTime: '8:00 AM', meetupLocation: 'Loc 1',
          idempotencyKey: `upd-iso-create-1-${RUN_ID}`,
        });
      expect(itemOne.status).toBe(201);

      const itemTwo = await request(app)
        .post(`/groups/${isoGroupId}/itineraries`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: 'Item Two',
          meetupDate: '09/02/2026', meetupTime: '9:00 AM', meetupLocation: 'Loc 2',
          idempotencyKey: `upd-iso-create-2-${RUN_ID}`,
        });
      expect(itemTwo.status).toBe(201);
      expect(itemTwo.body.id).not.toBe(itemOne.body.id);

      // Use the SAME update idempotency key against BOTH items. Under
      // the old scope the second PATCH would either 409 or replay the
      // first item's response. With resource-scoped idempotency both
      // updates succeed and apply the caller's new data.
      const sharedUpdateKey = `shared-update-key-${RUN_ID}`;

      const updOne = await request(app)
        .patch(`/groups/${isoGroupId}/itineraries/${itemOne.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Item One updated', idempotencyKey: sharedUpdateKey });
      expect(updOne.status).toBe(200);
      expect(updOne.body.title).toBe('Item One updated');
      expect(updOne.body.id).toBe(itemOne.body.id);

      const updTwo = await request(app)
        .patch(`/groups/${isoGroupId}/itineraries/${itemTwo.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Item Two updated', idempotencyKey: sharedUpdateKey });
      expect(updTwo.status).toBe(200);
      expect(updTwo.body.title).toBe('Item Two updated');
      expect(updTwo.body.id).toBe(itemTwo.body.id);

      // Cross-check: the first item's title was NOT overwritten by the
      // second update (i.e. no accidental merge).
      const getOne = await request(app)
        .get(`/groups/${isoGroupId}/itineraries/${itemOne.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(getOne.status).toBe(200);
      expect(getOne.body.title).toBe('Item One updated');
    });

    test('same key + same item + SAME body → replays stored response (no extra write)', async () => {
      const g = await request(app).post('/groups')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `Update Replay ${RUN_ID}` });
      const groupId2: string = g.body.id;

      const created = await request(app)
        .post(`/groups/${groupId2}/itineraries`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: 'Replay Target',
          meetupDate: '09/10/2026', meetupTime: '8:00 AM', meetupLocation: 'Loc',
          idempotencyKey: `upd-replay-create-${RUN_ID}`,
        });
      expect(created.status).toBe(201);

      const updKey = `upd-replay-key-${RUN_ID}`;
      const first = await request(app)
        .patch(`/groups/${groupId2}/itineraries/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'First update', idempotencyKey: updKey });
      expect(first.status).toBe(200);

      const replay = await request(app)
        .patch(`/groups/${groupId2}/itineraries/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'First update', idempotencyKey: updKey });
      expect(replay.status).toBe(200);
      // Replayed response mirrors the stored one.
      expect(replay.body.id).toBe(first.body.id);
      expect(replay.body.title).toBe('First update');
    });

    test('same key + same item + DIFFERENT body → 409 IDEMPOTENCY_CONFLICT', async () => {
      const g = await request(app).post('/groups')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `Update Conflict ${RUN_ID}` });
      const groupId3: string = g.body.id;

      const created = await request(app)
        .post(`/groups/${groupId3}/itineraries`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: 'Conflict Target',
          meetupDate: '09/20/2026', meetupTime: '8:00 AM', meetupLocation: 'Loc',
          idempotencyKey: `upd-conflict-create-${RUN_ID}`,
        });
      expect(created.status).toBe(201);

      const updKey = `upd-conflict-key-${RUN_ID}`;
      const first = await request(app)
        .patch(`/groups/${groupId3}/itineraries/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'First update', idempotencyKey: updKey });
      expect(first.status).toBe(200);

      const conflict = await request(app)
        .patch(`/groups/${groupId3}/itineraries/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Second update with different body', idempotencyKey: updKey });
      expect(conflict.status).toBe(409);
      expect(conflict.body.code).toBe('IDEMPOTENCY_CONFLICT');
    });
  });
});
