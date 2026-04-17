/**
 * Group service branch tests.
 *
 * The earlier version of this file asserted against a regex and a
 * join-code generation pattern that were DUPLICATED in the test
 * file — synthetic tests that would happily pass even when the
 * production code drifted. This rewrite binds to the real
 * `group.service.ts` module and exercises its branches directly.
 *
 * Important about the Sequelize mock (`src/__mocks__/sequelize.mock.ts`):
 * every Sequelize Model subclass (Group, GroupMember, …) inherits the
 * SAME `static create = jest.fn()` / `static findOne = jest.fn()` /
 * etc. from the mock base class — so `Group.create` and
 * `GroupMember.create` are literally the same `jest.fn()` under the
 * hood. That means:
 *
 *   - `mockResolvedValueOnce` queues per-call responses across models
 *   - `(Group.create as jest.Mock).mock.calls[i][0]` is the args for
 *     the i-th combined Model.create invocation
 *
 * Keep those semantics in mind when ordering expectations below.
 */

import * as groupService from '../src/services/group.service';
import { Group, GroupMember, GroupRequiredField, MemberFieldValue } from '../src/models/group.model';
import { AppError } from '../src/utils/errors';

jest.mock('../src/services/notification.service', () => ({
  emitNotification: jest.fn().mockResolvedValue(undefined),
}));

describe('Slice 4 — group.service branch coverage', () => {
  beforeEach(() => {
    // Reset the shared Model mocks before every test so call counts
    // and queued resolutions don't bleed across cases.
    (Group.create as jest.Mock).mockReset();
    (Group.findByPk as jest.Mock).mockReset();
    (Group.findOne as jest.Mock).mockReset();
    (Group.update as jest.Mock).mockReset();
    (GroupRequiredField.findAll as jest.Mock).mockReset();
    (MemberFieldValue.findOne as jest.Mock).mockReset();
    (MemberFieldValue.create as jest.Mock).mockReset();
    // `GroupMember.*` shares the same underlying jest.fn with
    // `Group.*` (see module header). Resetting either resets both.
  });

  describe('createGroup', () => {
    test('generates an 8-character uppercase hex join code and routes it to Group.create', async () => {
      // createGroup makes two Model.create calls in order:
      //   1) Group.create({ id, name, owner_id, join_code })
      //   2) GroupMember.create({ role: 'owner', ... })
      (Group.create as jest.Mock)
        .mockResolvedValueOnce({ id: 'g1' })   // Group.create
        .mockResolvedValueOnce({ id: 'm1' });  // GroupMember.create

      await groupService.createGroup('user-1', 'Test Group');

      const firstCallArgs = (Group.create as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
      expect(firstCallArgs.name).toBe('Test Group');
      expect(firstCallArgs.owner_id).toBe('user-1');
      expect(typeof firstCallArgs.join_code).toBe('string');
      expect(firstCallArgs.join_code as string).toMatch(/^[0-9A-F]{8}$/);
    });

    test('adds the creator as an owner membership', async () => {
      (Group.create as jest.Mock)
        .mockResolvedValueOnce({ id: 'g1' })
        .mockResolvedValueOnce({ id: 'm1' });

      await groupService.createGroup('user-42', 'Trip');

      const memberCallArgs = (Group.create as jest.Mock).mock.calls[1][0] as Record<string, unknown>;
      expect(memberCallArgs.role).toBe('owner');
      expect(memberCallArgs.user_id).toBe('user-42');
    });
  });

  describe('joinGroup', () => {
    test('404 NOT_FOUND when join code does not match any group', async () => {
      (Group.findOne as jest.Mock).mockResolvedValueOnce(null);
      await expect(groupService.joinGroup('user-1', 'NO_SUCH')).rejects.toBeInstanceOf(AppError);
    });

    test('404 NOT_FOUND when the group exists but is archived', async () => {
      (Group.findOne as jest.Mock).mockResolvedValueOnce({ id: 'g1', status: 'archived' });
      await expect(groupService.joinGroup('user-1', 'ABCDEF12')).rejects.toMatchObject({
        statusCode: 404, code: 'NOT_FOUND',
      });
    });

    test('409 CONFLICT when caller is already a member', async () => {
      (Group.findOne as jest.Mock).mockResolvedValueOnce({ id: 'g1', status: 'active' });
      (GroupMember.findOne as jest.Mock).mockResolvedValueOnce({ id: 'm1', user_id: 'u1', group_id: 'g1' });
      let caught: unknown;
      try { await groupService.joinGroup('u1', 'ABCDEF12'); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(AppError);
      expect((caught as AppError).statusCode).toBe(409);
      expect((caught as AppError).code).toBe('CONFLICT');
    });

    test('happy path — creates a member row and returns the group', async () => {
      const group = { id: 'g1', status: 'active', name: 'ok' };
      (Group.findOne as jest.Mock).mockResolvedValueOnce(group);
      (GroupMember.findOne as jest.Mock).mockResolvedValueOnce(null);
      (GroupMember.create as jest.Mock).mockResolvedValueOnce({ id: 'm-new' });

      const returned = await groupService.joinGroup('u-new', 'ABCDEF12');
      expect(returned).toBe(group);
      const createCalls = (GroupMember.create as jest.Mock).mock.calls;
      expect(createCalls.length).toBeGreaterThanOrEqual(1);
      // The last create call must be for the new membership with
      // role 'member'.
      const lastArgs = createCalls[createCalls.length - 1][0] as Record<string, unknown>;
      expect(lastArgs.role).toBe('member');
      expect(lastArgs.user_id).toBe('u-new');
      expect(lastArgs.group_id).toBe('g1');
    });
  });

  describe('removeMember', () => {
    test('404 when the target is not a member', async () => {
      // assertOwnerOrAdmin → assertMember calls GroupMember.findOne(actor)
      // then the service calls GroupMember.findOne(target)
      (GroupMember.findOne as jest.Mock)
        .mockResolvedValueOnce({ role: 'owner', user_id: 'actor' }) // actor membership (owner)
        .mockResolvedValueOnce(null);                                // target lookup
      await expect(groupService.removeMember('g1', 'actor', 'target')).rejects.toMatchObject({
        statusCode: 404, code: 'NOT_FOUND',
      });
    });

    test('409 when trying to remove the owner', async () => {
      (GroupMember.findOne as jest.Mock)
        .mockResolvedValueOnce({ role: 'owner', user_id: 'actor' })
        .mockResolvedValueOnce({ id: 'm2', role: 'owner', user_id: 'target' });
      await expect(groupService.removeMember('g1', 'actor', 'target')).rejects.toMatchObject({
        statusCode: 409, code: 'CONFLICT',
      });
    });

    test('destroys membership when target is a plain member', async () => {
      (GroupMember.findOne as jest.Mock)
        .mockResolvedValueOnce({ role: 'owner', user_id: 'actor' })
        .mockResolvedValueOnce({ id: 'm2', role: 'member', user_id: 'target' });
      (GroupMember.destroy as jest.Mock).mockResolvedValueOnce(1);

      await groupService.removeMember('g1', 'actor', 'target');
      expect(GroupMember.destroy).toHaveBeenCalledWith({ where: { id: 'm2' } });
    });
  });

  describe('submitMyFields — phone validation branch', () => {
    test('throws VALIDATION_ERROR when a phone-typed field receives a non-US value', async () => {
      // assertMember probe:
      (GroupMember.findOne as jest.Mock).mockResolvedValueOnce({ id: 'm1' });
      (GroupRequiredField.findAll as jest.Mock).mockResolvedValueOnce([
        { field_name: 'emergency_phone', field_type: 'phone' },
      ]);

      await expect(
        groupService.submitMyFields('g1', 'u1', { emergency_phone: 'not-a-phone' })
      ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
    });

    test('accepts a valid US phone and writes it', async () => {
      (GroupMember.findOne as jest.Mock).mockResolvedValueOnce({ id: 'm1' });
      (GroupRequiredField.findAll as jest.Mock).mockResolvedValueOnce([
        { field_name: 'emergency_phone', field_type: 'phone' },
      ]);
      (MemberFieldValue.findOne as jest.Mock).mockResolvedValueOnce(null);
      // MemberFieldValue.create shares the same underlying fn as other
      // .create calls; the previous findOne resolved to null so the
      // service falls into the create branch for the one input field.
      (MemberFieldValue.create as jest.Mock).mockResolvedValueOnce({
        id: 'v1', field_name: 'emergency_phone', value: '(555) 123-4567',
      });

      const result = await groupService.submitMyFields('g1', 'u1', { emergency_phone: '(555) 123-4567' });
      expect(result.length).toBe(1);
    });

    test('non-phone field types skip the phone regex check', async () => {
      (GroupMember.findOne as jest.Mock).mockResolvedValueOnce({ id: 'm1' });
      (GroupRequiredField.findAll as jest.Mock).mockResolvedValueOnce([
        { field_name: 'vehicle_make', field_type: 'text' },
      ]);
      (MemberFieldValue.findOne as jest.Mock).mockResolvedValueOnce(null);
      (MemberFieldValue.create as jest.Mock).mockResolvedValueOnce({
        id: 'v1', field_name: 'vehicle_make', value: 'Toyota',
      });

      const result = await groupService.submitMyFields('g1', 'u1', { vehicle_make: 'Toyota' });
      expect(result.length).toBe(1);
    });
  });

  describe('updateGroup', () => {
    test('403 when caller is a plain member', async () => {
      (GroupMember.findOne as jest.Mock).mockResolvedValueOnce({ role: 'member', user_id: 'actor' });
      await expect(groupService.updateGroup('g1', 'actor', { name: 'X' })).rejects.toMatchObject({
        statusCode: 403, code: 'FORBIDDEN',
      });
    });

    test('owner can update the name; Group.update is called with the patch', async () => {
      (GroupMember.findOne as jest.Mock).mockResolvedValueOnce({ role: 'owner', user_id: 'actor' });
      (Group.findByPk as jest.Mock)
        .mockResolvedValueOnce({ id: 'g1', name: 'Old' })
        .mockResolvedValueOnce({ id: 'g1', name: 'New' });
      (Group.update as jest.Mock).mockResolvedValueOnce([1]);

      const updated = await groupService.updateGroup('g1', 'actor', { name: 'New' });
      expect(Group.update).toHaveBeenCalledWith({ name: 'New' }, { where: { id: 'g1' } });
      expect((updated as { name: string } | null)?.name).toBe('New');
    });
  });
});
