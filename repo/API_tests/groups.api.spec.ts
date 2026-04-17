import request from 'supertest';
import app from '../src/app';
import { sequelize } from '../src/config/database';
import { describeDb } from './db-guard';

let adminToken: string;
let memberToken: string;
let memberId: string;
let groupId: string;
let joinCode: string;

describeDb('Slice 4 — Groups API', () => {
  beforeAll(async () => {
    await sequelize.authenticate();

    const adminRes = await request(app).post('/auth/login').send({ username: 'admin', password: 'Admin1!pass' });
    adminToken = adminRes.body.accessToken;

    const memberRes = await request(app).post('/auth/login').send({ username: 'member1', password: 'Member1!pass' });
    memberToken = memberRes.body.accessToken;
    memberId = memberRes.body.user.id;
  });

  afterAll(async () => {
    await sequelize.close();
  });

  describe('POST /groups', () => {
    test('201 — creates group with join code', async () => {
      const res = await request(app)
        .post('/groups')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Test Group Alpha' });
      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.name).toBe('Test Group Alpha');
      expect(res.body.join_code).toBeDefined();
      expect(res.body.join_code).toMatch(/^[0-9A-F]{8}$/);
      groupId = res.body.id;
      joinCode = res.body.join_code;
    });

    test('401 — without token', async () => {
      const res = await request(app).post('/groups').send({ name: 'No Auth' });
      expect(res.status).toBe(401);
    });

    test('403 — member is itinerary-only and cannot create groups', async () => {
      // Strict prompt compliance: the `member` user role does not have
      // group lifecycle privileges. The role gate on POST /groups
      // blocks them at the route layer.
      const res = await request(app)
        .post('/groups')
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ name: 'Member-attempted Group' });
      expect(res.status).toBe(403);
    });
  });

  describe('POST /groups/join', () => {
    test('200 — joins group by code', async () => {
      const res = await request(app)
        .post('/groups/join')
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ joinCode });
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(groupId);
    });

    test('409 — duplicate join', async () => {
      const res = await request(app)
        .post('/groups/join')
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ joinCode });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('CONFLICT');
    });

    test('404 — invalid join code', async () => {
      const res = await request(app)
        .post('/groups/join')
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ joinCode: 'ZZZZZZZZ' });
      expect(res.status).toBe(404);
    });
  });

  describe('GET /groups', () => {
    test('200 — lists own groups', async () => {
      const res = await request(app)
        .get('/groups')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('GET /groups/:id', () => {
    test('200 — get group as member', async () => {
      const res = await request(app)
        .get(`/groups/${groupId}`)
        .set('Authorization', `Bearer ${memberToken}`);
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Test Group Alpha');
    });

    test('403 — non-member cannot access', async () => {
      // Register fresh user who hasn't joined
      const regRes = await request(app)
        .post('/auth/register')
        .send({ username: `outsider_${Date.now()}`, password: 'Outsider1!xx' });
      const loginRes = await request(app)
        .post('/auth/login')
        .send({ username: regRes.body.username, password: 'Outsider1!xx' });
      const outsiderToken = loginRes.body.accessToken;

      const res = await request(app)
        .get(`/groups/${groupId}`)
        .set('Authorization', `Bearer ${outsiderToken}`);
      expect(res.status).toBe(403);
    });
  });

  describe('PATCH /groups/:id', () => {
    test('200 — owner can update name', async () => {
      const res = await request(app)
        .patch(`/groups/${groupId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Updated Group Alpha' });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Updated Group Alpha');
    });

    test('403 — member cannot update', async () => {
      const res = await request(app)
        .patch(`/groups/${groupId}`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ name: 'Hacked Name' });
      expect(res.status).toBe(403);
    });
  });

  describe('GET /groups/:id/members', () => {
    test('200 — lists members', async () => {
      const res = await request(app)
        .get(`/groups/${groupId}/members`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(2); // owner + member1
    });
  });

  describe('Required fields', () => {
    let fieldId: string;

    test('POST /groups/:id/required-fields 201 — owner adds field', async () => {
      const res = await request(app)
        .post(`/groups/${groupId}/required-fields`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ fieldName: 'vehicle_make', fieldType: 'text', isRequired: true });
      expect(res.status).toBe(201);
      expect(res.body.field_name).toBe('vehicle_make');
      fieldId = res.body.id;
    });

    test('POST — add phone field', async () => {
      const res = await request(app)
        .post(`/groups/${groupId}/required-fields`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ fieldName: 'emergency_phone', fieldType: 'phone', isRequired: true });
      expect(res.status).toBe(201);
    });

    test('GET /groups/:id/required-fields 200 — lists fields', async () => {
      const res = await request(app)
        .get(`/groups/${groupId}/required-fields`)
        .set('Authorization', `Bearer ${memberToken}`);
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(2);
    });

    test('PATCH /groups/:id/required-fields/:fieldId 200 — update', async () => {
      const res = await request(app)
        .patch(`/groups/${groupId}/required-fields/${fieldId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isRequired: false });
      expect(res.status).toBe(200);
      expect(res.body.is_required).toBe(false);
    });

    test('POST required-fields 403 — member cannot add', async () => {
      const res = await request(app)
        .post(`/groups/${groupId}/required-fields`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ fieldName: 'hack_field', fieldType: 'text' });
      expect(res.status).toBe(403);
    });

    // ─── DELETE /groups/:id/required-fields/:fieldId ────────────────
    // Previously uncovered; audit-flagged gap.
    describe('DELETE /groups/:id/required-fields/:fieldId', () => {
      let tempFieldId: string;

      test('setup — owner creates a field that will be deleted', async () => {
        const res = await request(app)
          .post(`/groups/${groupId}/required-fields`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ fieldName: 'deletable_field', fieldType: 'text', isRequired: false });
        expect(res.status).toBe(201);
        expect(res.body.field_name).toBe('deletable_field');
        tempFieldId = res.body.id;
      });

      test('403 — member cannot delete a required-field config', async () => {
        const res = await request(app)
          .delete(`/groups/${groupId}/required-fields/${tempFieldId}`)
          .set('Authorization', `Bearer ${memberToken}`);
        expect(res.status).toBe(403);
      });

      test('204 — owner can delete a required-field config', async () => {
        const res = await request(app)
          .delete(`/groups/${groupId}/required-fields/${tempFieldId}`)
          .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(204);
        // 204 by contract has an empty body
        expect(res.text === '' || res.text === undefined).toBe(true);
      });

      test('list no longer contains the deleted field', async () => {
        const list = await request(app)
          .get(`/groups/${groupId}/required-fields`)
          .set('Authorization', `Bearer ${memberToken}`);
        expect(list.status).toBe(200);
        const names: string[] = list.body.map((f: { field_name: string }) => f.field_name);
        expect(names).not.toContain('deletable_field');
      });
    });
  });

  describe('Member field values', () => {
    test('PUT /groups/:id/my-fields 200 — submit values', async () => {
      const res = await request(app)
        .put(`/groups/${groupId}/my-fields`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ vehicle_make: 'Toyota', emergency_phone: '123-456-7890' });
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(2);
    });

    test('GET /groups/:id/my-fields 200 — get own values', async () => {
      const res = await request(app)
        .get(`/groups/${groupId}/my-fields`)
        .set('Authorization', `Bearer ${memberToken}`);
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(2);
    });

    test('PUT my-fields 400 — invalid phone format', async () => {
      const res = await request(app)
        .put(`/groups/${groupId}/my-fields`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ emergency_phone: 'not-a-phone' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('DELETE /groups/:id/members/:userId', () => {
    test('204 — owner removes member', async () => {
      const res = await request(app)
        .delete(`/groups/${groupId}/members/${memberId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(204);
    });

    test('verify member removed from list', async () => {
      const res = await request(app)
        .get(`/groups/${groupId}/members`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(1);
    });
  });
});
