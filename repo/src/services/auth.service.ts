import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import archiver from 'archiver';
import fs from 'fs';
import path from 'path';
import { User } from '../models/user.model';
import { ActivityLog } from '../models/activity-log.model';
import { FileRecord } from '../models/file.model';
import { GroupMember, Group } from '../models/group.model';
import { FaceEnrollment } from '../models/face.model';
import { AuditLog } from '../models/audit.model';
import { ExportRecord } from '../models/export.model';
import { AppError, ErrorCodes } from '../utils/errors';
import { config } from '../config/environment';
import { authConfig } from '../config/auth';
import { JwtPayload, TokenResponse } from '../types/auth.types';
import { traceStore, createCategoryLogger } from '../utils/logger';

const authLogger = createCategoryLogger('auth');

const BCRYPT_ROUNDS = 12;
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

const PASSWORD_REGEX = /^(?=.*\d)(?=.*[^a-zA-Z0-9]).{10,}$/;

function validatePassword(password: string): void {
  if (!PASSWORD_REGEX.test(password)) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR.statusCode,
      ErrorCodes.VALIDATION_ERROR.code,
      'Password must be at least 10 characters with at least 1 number and 1 symbol'
    );
  }
}

function getTraceId(): string | undefined {
  return traceStore.getStore()?.traceId;
}

async function logActivity(userId: string, action: string, detail?: Record<string, unknown>): Promise<void> {
  await ActivityLog.create({
    id: uuidv4(),
    user_id: userId,
    action,
    detail: detail || null,
    trace_id: getTraceId() || null,
    created_at: new Date(),
  });
}

async function logAudit(actorId: string | null, action: string, resourceType?: string, resourceId?: string, detail?: Record<string, unknown>, ipAddress?: string): Promise<void> {
  await AuditLog.create({
    id: uuidv4(),
    actor_id: actorId,
    action,
    resource_type: resourceType || null,
    resource_id: resourceId || null,
    detail: detail || null,
    trace_id: getTraceId() || null,
    ip_address: ipAddress || null,
    created_at: new Date(),
  });
}

export async function register(
  username: string,
  password: string
): Promise<{ id: string; username: string; role: string }> {
  validatePassword(password);

  const existing = await User.findOne({ where: { username } });
  if (existing) {
    throw new AppError(
      ErrorCodes.CONFLICT.statusCode,
      ErrorCodes.CONFLICT.code,
      'Username already taken'
    );
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const id = uuidv4();

  const user = await User.create({
    id,
    username,
    password_hash: passwordHash,
    role: 'member',
  });

  await logActivity(id, 'register', { username });
  await logAudit(id, 'register', 'user', id, { username });
  authLogger.info('User registered', { userId: id, username });

  return { id: user.id, username: user.username, role: user.role };
}

export async function login(
  username: string,
  password: string
): Promise<TokenResponse> {
  const user = await User.findOne({ where: { username } });

  if (!user) {
    throw new AppError(
      ErrorCodes.UNAUTHORIZED.statusCode,
      ErrorCodes.UNAUTHORIZED.code,
      'Invalid credentials'
    );
  }

  if (user.status === 'deleted') {
    throw new AppError(
      ErrorCodes.UNAUTHORIZED.statusCode,
      ErrorCodes.UNAUTHORIZED.code,
      'Invalid credentials'
    );
  }

  // Check lockout
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    throw new AppError(423, 'ACCOUNT_LOCKED', 'Account is temporarily locked due to too many failed attempts');
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    const newFailedAttempts = user.failed_attempts + 1;
    const updateData: Record<string, unknown> = { failed_attempts: newFailedAttempts };

    if (newFailedAttempts >= LOCKOUT_THRESHOLD) {
      updateData.locked_until = new Date(Date.now() + LOCKOUT_DURATION_MS);
      authLogger.warn('Account locked due to failed attempts', { userId: user.id, username });
    }

    await User.update(updateData, { where: { id: user.id } });

    throw new AppError(
      ErrorCodes.UNAUTHORIZED.statusCode,
      ErrorCodes.UNAUTHORIZED.code,
      'Invalid credentials'
    );
  }

  // Reset failed attempts on success
  await User.update(
    { failed_attempts: 0, locked_until: null },
    { where: { id: user.id } }
  );

  const payload: JwtPayload = {
    userId: user.id,
    username: user.username,
    role: user.role,
    ...(user.property_id ? { propertyId: user.property_id } : {}),
  };

  const accessToken = jwt.sign(payload, authConfig.secret, {
    algorithm: authConfig.algorithm,
    expiresIn: authConfig.ttl,
  });

  await logActivity(user.id, 'login', { username });
  await logAudit(user.id, 'login', 'user', user.id);
  authLogger.info('User logged in', { userId: user.id, username });

  return {
    accessToken,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
    },
  };
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<void> {
  const user = await User.findByPk(userId);
  if (!user) {
    throw new AppError(ErrorCodes.NOT_FOUND.statusCode, ErrorCodes.NOT_FOUND.code, 'User not found');
  }

  const valid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!valid) {
    throw new AppError(ErrorCodes.UNAUTHORIZED.statusCode, ErrorCodes.UNAUTHORIZED.code, 'Current password is incorrect');
  }

  validatePassword(newPassword);
  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await User.update({ password_hash: passwordHash }, { where: { id: userId } });

  await logActivity(userId, 'change_password');
  await logAudit(userId, 'change_password', 'user', userId);
  authLogger.info('Password changed', { userId });
}

export async function getProfile(userId: string): Promise<Omit<User, 'password_hash'>> {
  const user = await User.findByPk(userId, {
    attributes: { exclude: ['password_hash'] },
  });
  if (!user) {
    throw new AppError(ErrorCodes.NOT_FOUND.statusCode, ErrorCodes.NOT_FOUND.code, 'User not found');
  }
  return user;
}

export async function updateProfile(
  userId: string,
  data: {
    legal_name?: string;
    address_line1?: string;
    address_line2?: string;
    city?: string;
    state?: string;
    zip?: string;
    tax_invoice_title?: string;
    preferred_currency?: string;
  }
): Promise<Omit<User, 'password_hash'>> {
  const user = await User.findByPk(userId);
  if (!user) {
    throw new AppError(ErrorCodes.NOT_FOUND.statusCode, ErrorCodes.NOT_FOUND.code, 'User not found');
  }

  await User.update(data, { where: { id: userId } });
  await logActivity(userId, 'update_profile', { fields: Object.keys(data) });

  return getProfile(userId);
}

export async function deleteAccount(userId: string, password: string): Promise<void> {
  const user = await User.findByPk(userId);
  if (!user) {
    throw new AppError(ErrorCodes.NOT_FOUND.statusCode, ErrorCodes.NOT_FOUND.code, 'User not found');
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    throw new AppError(ErrorCodes.UNAUTHORIZED.statusCode, ErrorCodes.UNAUTHORIZED.code, 'Invalid password');
  }

  // Deactivate face enrollments
  await FaceEnrollment.update({ status: 'deactivated' }, { where: { user_id: userId, status: 'active' } });

  // Transfer owned groups or archive them
  const ownedGroups = await GroupMember.findAll({ where: { user_id: userId, role: 'owner' } });
  for (const membership of ownedGroups) {
    const nextAdmin = await GroupMember.findOne({
      where: { group_id: membership.group_id, role: 'admin', user_id: { [require('sequelize').Op.ne]: userId } },
    });
    if (nextAdmin) {
      await GroupMember.update({ role: 'owner' }, { where: { id: nextAdmin.id } });
      // Keep groups.owner_id consistent with the new owner
      await Group.update({ owner_id: nextAdmin.user_id }, { where: { id: membership.group_id } });
    } else {
      await Group.update({ status: 'archived' }, { where: { id: membership.group_id } });
    }
  }

  // Remove all group memberships
  await GroupMember.destroy({ where: { user_id: userId } });

  // Soft-delete user
  await User.update(
    { status: 'deleted', deleted_at: new Date() },
    { where: { id: userId } }
  );

  await logActivity(userId, 'delete_account');
  await logAudit(userId, 'delete_account', 'user', userId, {
    cascaded: { faceEnrollmentsDeactivated: true, groupMembershipsRemoved: true, ownedGroupsHandled: ownedGroups.length },
  });
  authLogger.info('Account deleted with cascade', { userId });
}

export async function exportData(
  userId: string
): Promise<{ downloadUrl: string; expiresAt: string }> {
  const user = await User.findByPk(userId, {
    attributes: { exclude: ['password_hash'] },
  });
  if (!user) {
    throw new AppError(ErrorCodes.NOT_FOUND.statusCode, ErrorCodes.NOT_FOUND.code, 'User not found');
  }

  const activities = await ActivityLog.findAll({
    where: { user_id: userId },
    order: [['created_at', 'DESC']],
  });

  const exportId = uuidv4();
  const filename = `export-${userId}-${exportId}.zip`;
  const exportDir = path.resolve('exports');

  if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true });
  }

  // Gather uploaded files before archiving
  const uploadedFiles = await FileRecord.findAll({ where: { uploaded_by: userId } });

  const archivePath = path.join(exportDir, filename);
  const output = fs.createWriteStream(archivePath);
  const archive = archiver('zip', { zlib: { level: 9 } });

  return new Promise((resolve, reject) => {
    output.on('close', async () => {
      // Register export ownership record. expiresAt is exposed in the
      // response so the caller knows the download window without
      // having to query the export records table.
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await ExportRecord.create({
        id: exportId, user_id: userId, filename,
        export_type: 'account_data',
        expires_at: expiresAt,
        created_at: new Date(),
      });
      await logActivity(userId, 'export_data', { filename });
      await logAudit(userId, 'export_data', 'user', userId, { filename });
      authLogger.info('Data exported', { userId, filename });
      resolve({
        downloadUrl: `/exports/${filename}`,
        expiresAt: expiresAt.toISOString(),
      });
    });

    archive.on('error', (err: Error) => reject(err));
    archive.pipe(output);

    archive.append(JSON.stringify(user.toJSON(), null, 2), { name: 'profile.json' });
    archive.append(
      JSON.stringify(activities.map((a) => a.toJSON()), null, 2),
      { name: 'activity.json' }
    );

    // Include uploaded files
    for (const file of uploadedFiles) {
      const diskPath = path.resolve(file.storage_path);
      if (fs.existsSync(diskPath)) {
        archive.file(diskPath, { name: `files/${file.original_name}` });
      }
    }

    archive.finalize();
  });
}

export async function logout(userId: string): Promise<void> {
  await logActivity(userId, 'logout');
  await logAudit(userId, 'logout', 'user', userId);
  authLogger.info('User logged out', { userId });
}
