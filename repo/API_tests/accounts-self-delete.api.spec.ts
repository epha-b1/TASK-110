/**
 * /accounts/me/delete — account self-delete cascade.
 *
 * This spec provides end-to-end API coverage for the cascade logic in
 * `authService.deleteAccount` (src/services/auth.service.ts). The audit
 * flagged that the cascade had no direct API test — the existing suite
 * only exercised the service via an internal unit test, which cannot
 * catch controller-level regressions (auth middleware, req.user scope,
 * validation, error envelope).
 *
 * The scenarios covered here, all against the live `POST /accounts/me/delete`
 * route, are:
 *
 *   1. Successful self-delete with correct password
 *   2. Wrong password → rejected before any destructive work runs
 *   3. All group memberships of the deleted user are gone
 *   4. Owner-of-group is transferred to next admin when one exists
 *   5. Owner-of-group causes group to archive when no admin exists
 *   6. User row soft-deleted: status = 'deleted' AND deleted_at set
 *   7. Deleted user cannot re-authenticate (login returns 401)
 *   8. Active face enrollment is deactivated by the cascade (fixture present)
 *
 * Each test provisions its own users via `/auth/register` and its own
 * groups via `/groups` so tests do not share state. For scenarios that
 * need a second member with the `admin` role (owner-transfer case) the
 * test reaches into the `GroupMember` model directly — the public API
 * does not expose a member-role promotion endpoint.
 */

import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import app from '../src/app';
import { sequelize } from '../src/config/database';
import { User } from '../src/models/user.model';
import { Group, GroupMember } from '../src/models/group.model';
import { FaceEnrollment } from '../src/models/face.model';
import { describeDb } from './db-guard';

const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// All passwords meet the 10+ / number / symbol requirement.
const PASSWORD = 'SelfDel1!pass';
const WRONG_PASSWORD = 'NotTheOne1!xx';

interface TestActor {
  id: string;
  username: string;
  token: string;
}

async function register(suffix: string): Promise<TestActor> {
  const username = `selfdel_${suffix}_${RUN_ID}`;
  const reg = await request(app).post('/auth/register').send({ username, password: PASSWORD });
  if (reg.status !== 201) {
    throw new Error(`register failed: ${reg.status} ${JSON.stringify(reg.body)}`);
  }
  const login = await request(app).post('/auth/login').send({ username, password: PASSWORD });
  if (login.status !== 200) {
    throw new Error(`login failed: ${login.status} ${JSON.stringify(login.body)}`);
  }
  return { id: reg.body.id, username, token: login.body.accessToken };
}

describeDb('Accounts self-delete cascade — POST /accounts/me/delete', () => {
  beforeAll(async () => {
    await sequelize.authenticate();
  });

  afterAll(async () => {
    await sequelize.close();
  });

  // ─── 1. Happy path ────────────────────────────────────────────────
  test('200 — successful self-delete with correct password', async () => {
    const user = await register('happy');
    const res = await request(app)
      .post('/accounts/me/delete')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.message).toBeDefined();
  });

  // ─── 2. Wrong password ────────────────────────────────────────────
  test('401 — wrong password is rejected and no cascade runs', async () => {
    const user = await register('wrongpw');

    // Create a group owned by this user so we can assert nothing was
    // cascaded if the password check fails.
    const g = await request(app).post('/groups')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ name: `Wrong PW Group ${RUN_ID}` });
    expect(g.status).toBe(201);

    const res = await request(app)
      .post('/accounts/me/delete')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ password: WRONG_PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');

    // User row still active
    const stillThere = await User.findOne({ where: { id: user.id }, paranoid: false });
    expect(stillThere).not.toBeNull();
    expect(stillThere!.status).toBe('active');
    expect(stillThere!.deleted_at).toBeNull();

    // Group still active and user still owner
    const groupRow = await Group.findByPk(g.body.id);
    expect(groupRow).not.toBeNull();
    expect(groupRow!.status).toBe('active');

    const ownerMembership = await GroupMember.findOne({
      where: { group_id: g.body.id, user_id: user.id },
    });
    expect(ownerMembership).not.toBeNull();
    expect(ownerMembership!.role).toBe('owner');
  });

  // ─── 3. Group membership removal ──────────────────────────────────
  test('cascade — all group memberships of the deleted user are gone', async () => {
    const owner = await register('multi-owner');
    const memberOnly = await register('multi-member');

    // owner creates group A and group B
    const gA = await request(app).post('/groups')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: `MR A ${RUN_ID}` });
    const gB = await request(app).post('/groups')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: `MR B ${RUN_ID}` });

    // memberOnly joins both as a plain member
    await request(app).post('/groups/join')
      .set('Authorization', `Bearer ${memberOnly.token}`)
      .send({ joinCode: gA.body.join_code });
    await request(app).post('/groups/join')
      .set('Authorization', `Bearer ${memberOnly.token}`)
      .send({ joinCode: gB.body.join_code });

    // Sanity check: memberOnly has 2 memberships before delete
    const beforeCount = await GroupMember.count({ where: { user_id: memberOnly.id } });
    expect(beforeCount).toBe(2);

    // memberOnly self-deletes
    const del = await request(app)
      .post('/accounts/me/delete')
      .set('Authorization', `Bearer ${memberOnly.token}`)
      .send({ password: PASSWORD });
    expect(del.status).toBe(200);

    // All of their memberships are gone
    const afterCount = await GroupMember.count({ where: { user_id: memberOnly.id } });
    expect(afterCount).toBe(0);

    // But the groups themselves are still there because the owner is
    // untouched. This proves the cascade didn't nuke the whole tree.
    const stillA = await Group.findByPk(gA.body.id);
    const stillB = await Group.findByPk(gB.body.id);
    expect(stillA!.status).toBe('active');
    expect(stillB!.status).toBe('active');
  });

  // ─── 4. Owner transfer to next admin ──────────────────────────────
  test('cascade — owner transfers to next admin when one exists', async () => {
    const owner = await register('owner-xfer');
    const adminMember = await register('owner-xfer-admin');

    const g = await request(app).post('/groups')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: `Xfer ${RUN_ID}` });
    expect(g.status).toBe(201);
    const groupId = g.body.id as string;

    // adminMember joins, then is promoted to admin by reaching into the
    // model directly. The public API does not expose a member-role
    // promotion endpoint at the time of writing, so DB-level promotion
    // is the only way to build this fixture.
    await request(app).post('/groups/join')
      .set('Authorization', `Bearer ${adminMember.token}`)
      .send({ joinCode: g.body.join_code });
    await GroupMember.update(
      { role: 'admin' },
      { where: { group_id: groupId, user_id: adminMember.id } }
    );

    // owner self-deletes
    const del = await request(app)
      .post('/accounts/me/delete')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ password: PASSWORD });
    expect(del.status).toBe(200);

    // Group still active
    const groupRow = await Group.findByPk(groupId);
    expect(groupRow).not.toBeNull();
    expect(groupRow!.status).toBe('active');

    // groups.owner_id now points at the former admin
    expect(groupRow!.owner_id).toBe(adminMember.id);

    // adminMember's role is now 'owner'
    const promoted = await GroupMember.findOne({
      where: { group_id: groupId, user_id: adminMember.id },
    });
    expect(promoted).not.toBeNull();
    expect(promoted!.role).toBe('owner');

    // Original owner's membership is gone
    const oldMembership = await GroupMember.findOne({
      where: { group_id: groupId, user_id: owner.id },
    });
    expect(oldMembership).toBeNull();
  });

  // ─── 5. Group archived when no admin exists ───────────────────────
  test('cascade — group is archived when owner deletes and no admin exists', async () => {
    const owner = await register('owner-archive');

    const g = await request(app).post('/groups')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: `Archive ${RUN_ID}` });
    expect(g.status).toBe(201);
    const groupId = g.body.id as string;

    // Solo-owned group — no other members, no admin to transfer to.
    const del = await request(app)
      .post('/accounts/me/delete')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ password: PASSWORD });
    expect(del.status).toBe(200);

    const groupRow = await Group.findByPk(groupId);
    expect(groupRow).not.toBeNull();
    expect(groupRow!.status).toBe('archived');
  });

  // ─── 6. Soft-delete fields on user row ────────────────────────────
  test('cascade — user row has status=deleted and deleted_at set', async () => {
    const user = await register('softdel');

    const del = await request(app)
      .post('/accounts/me/delete')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ password: PASSWORD });
    expect(del.status).toBe(200);

    // paranoid: true on User means a default findByPk hides deleted
    // rows. Use `paranoid: false` so the assertion sees the row.
    const row = await User.findOne({ where: { id: user.id }, paranoid: false });
    expect(row).not.toBeNull();
    expect(row!.status).toBe('deleted');
    expect(row!.deleted_at).not.toBeNull();
  });

  // ─── 7. Deleted user cannot authenticate ──────────────────────────
  test('cascade — deleted user can no longer log in', async () => {
    const user = await register('nologin');

    const del = await request(app)
      .post('/accounts/me/delete')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ password: PASSWORD });
    expect(del.status).toBe(200);

    const reLogin = await request(app)
      .post('/auth/login')
      .send({ username: user.username, password: PASSWORD });
    expect(reLogin.status).toBe(401);
    expect(reLogin.body.code).toBe('UNAUTHORIZED');
  });

  // ─── 8. Face enrollment deactivation (optional, fixture seeded) ───
  test('cascade — active face enrollment is deactivated', async () => {
    const user = await register('face-cascade');

    // Seed an active face enrollment directly in the DB. We bypass the
    // enrollment API because the goal here is to verify the cascade,
    // not the enrollment flow itself.
    const enrollmentId = uuidv4();
    await FaceEnrollment.create({
      id: enrollmentId,
      user_id: user.id,
      version: 1,
      status: 'active',
      template_path: `face-templates/${enrollmentId}.enc`,
      angles_captured: { left: true, front: true, right: true },
      liveness_passed: true,
      liveness_meta: null,
      raw_image_path: null,
      raw_image_expires_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    } as any);

    const del = await request(app)
      .post('/accounts/me/delete')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ password: PASSWORD });
    expect(del.status).toBe(200);

    const enrollment = await FaceEnrollment.findByPk(enrollmentId);
    expect(enrollment).not.toBeNull();
    expect(enrollment!.status).toBe('deactivated');
  });

  // ─── 9. Auth middleware still guards the route ────────────────────
  test('401 — unauthenticated request rejected before cascade runs', async () => {
    const res = await request(app)
      .post('/accounts/me/delete')
      .send({ password: PASSWORD });
    expect(res.status).toBe(401);
  });
});
