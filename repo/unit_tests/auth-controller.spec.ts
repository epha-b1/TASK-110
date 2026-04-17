/**
 * Unit tests for src/controllers/auth.controller.ts
 *
 * These run against fabricated req/res/next to verify the controllers
 * wire their request bodies through to the service layer and convert
 * service results/errors into the right HTTP shape. The service
 * itself is mocked so we isolate the controller behavior — the real
 * service is covered end-to-end by the API integration tests in
 * `API_tests/auth.api.spec.ts`.
 *
 * Targets:
 *   - `register`      → 201 on success, error propagated via next()
 *   - `login`         → 200 on success, error propagated
 *   - `logout`        → 204 + empty body
 *   - `changePassword` → 200 + message body; `req.user.id` threaded
 *                         into the service call
 */

import * as authController from '../src/controllers/auth.controller';
import * as authService from '../src/services/auth.service';
import { Response } from 'express';
import { AuthenticatedRequest } from '../src/middleware/auth.middleware';

jest.mock('../src/services/auth.service');

type MockRes = Response & {
  _status?: number;
  _json?: unknown;
  _sent?: boolean;
};

function mockRes(): MockRes {
  const res = {} as MockRes;
  res.status = jest.fn(function (this: MockRes, code: number) {
    this._status = code;
    return this;
  }) as unknown as Response['status'];
  res.json = jest.fn(function (this: MockRes, body: unknown) {
    this._json = body;
    return this;
  }) as unknown as Response['json'];
  res.send = jest.fn(function (this: MockRes) {
    this._sent = true;
    return this;
  }) as unknown as Response['send'];
  return res;
}

describe('auth.controller — wiring', () => {
  beforeEach(() => {
    (authService.register as jest.Mock).mockReset();
    (authService.login as jest.Mock).mockReset();
    (authService.logout as jest.Mock).mockReset();
    (authService.changePassword as jest.Mock).mockReset();
  });

  describe('register', () => {
    test('201 on success; passes username+password to service', async () => {
      (authService.register as jest.Mock).mockResolvedValue({ id: 'u1', username: 'alice', role: 'member' });
      const req = { body: { username: 'alice', password: 'pw' } } as unknown as Parameters<typeof authController.register>[0];
      const res = mockRes();
      const next = jest.fn();

      await authController.register(req, res, next);

      expect(authService.register).toHaveBeenCalledWith('alice', 'pw');
      expect(res._status).toBe(201);
      expect(res._json).toMatchObject({ id: 'u1', username: 'alice' });
      expect(next).not.toHaveBeenCalled();
    });

    test('forwards service errors to next()', async () => {
      const err = new Error('boom');
      (authService.register as jest.Mock).mockRejectedValue(err);
      const req = { body: { username: 'a', password: 'b' } } as unknown as Parameters<typeof authController.register>[0];
      const res = mockRes();
      const next = jest.fn();

      await authController.register(req, res, next);

      expect(next).toHaveBeenCalledWith(err);
      expect(res._status).toBeUndefined();
    });
  });

  describe('login', () => {
    test('200 on success; body contains the service payload', async () => {
      (authService.login as jest.Mock).mockResolvedValue({ accessToken: 'JWT', user: { id: 'u1' } });
      const req = { body: { username: 'a', password: 'b' } } as unknown as Parameters<typeof authController.login>[0];
      const res = mockRes();
      const next = jest.fn();

      await authController.login(req, res, next);

      expect(res._status).toBe(200);
      expect(res._json).toMatchObject({ accessToken: 'JWT' });
    });

    test('forwards 401 from service via next()', async () => {
      const err = Object.assign(new Error('bad'), { statusCode: 401, code: 'UNAUTHORIZED' });
      (authService.login as jest.Mock).mockRejectedValue(err);
      const req = { body: {} } as unknown as Parameters<typeof authController.login>[0];
      const res = mockRes();
      const next = jest.fn();

      await authController.login(req, res, next);
      expect(next).toHaveBeenCalledWith(err);
    });
  });

  describe('logout', () => {
    test('204 and empty body; threads req.user.id into service', async () => {
      (authService.logout as jest.Mock).mockResolvedValue(undefined);
      const req = { user: { id: 'u1' } } as unknown as AuthenticatedRequest;
      const res = mockRes();
      const next = jest.fn();

      await authController.logout(req, res, next);

      expect(authService.logout).toHaveBeenCalledWith('u1');
      expect(res._status).toBe(204);
      expect(res._sent).toBe(true);
    });
  });

  describe('changePassword', () => {
    test('200 + message; passes user id + both passwords to service', async () => {
      (authService.changePassword as jest.Mock).mockResolvedValue(undefined);
      const req = {
        user: { id: 'u-42' },
        body: { currentPassword: 'old', newPassword: 'NewPass1!xy' },
      } as unknown as AuthenticatedRequest;
      const res = mockRes();
      const next = jest.fn();

      await authController.changePassword(req, res, next);

      expect(authService.changePassword).toHaveBeenCalledWith('u-42', 'old', 'NewPass1!xy');
      expect(res._status).toBe(200);
      expect(res._json).toMatchObject({ message: expect.any(String) });
    });

    test('forwards 401 from the service (wrong current password)', async () => {
      const err = Object.assign(new Error('bad pw'), { statusCode: 401, code: 'UNAUTHORIZED' });
      (authService.changePassword as jest.Mock).mockRejectedValue(err);
      const req = {
        user: { id: 'u1' },
        body: { currentPassword: 'x', newPassword: 'y' },
      } as unknown as AuthenticatedRequest;
      const res = mockRes();
      const next = jest.fn();

      await authController.changePassword(req, res, next);
      expect(next).toHaveBeenCalledWith(err);
      expect(res._status).toBeUndefined();
    });
  });
});
