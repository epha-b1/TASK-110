import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { ItineraryItem, ItineraryCheckpoint, MemberCheckin } from '../models/itinerary.model';
import { GroupMember, GroupRequiredField, MemberFieldValue } from '../models/group.model';
import { AppError, ErrorCodes } from '../utils/errors';
import { emitNotification } from './notification.service';
import { checkIdempotency, storeIdempotency } from './idempotency.service';
import { sequelize } from '../config/database';

// Hash the relevant create-payload fields for idempotency conflict
// detection. We deliberately exclude `idempotencyKey` itself so two
// requests with the same key always match by content alone.
function hashCreateBody(data: { title: string; meetupDate: string; meetupTime: string; meetupLocation: string; notes?: string }): string {
  const normalized = JSON.stringify({
    title: data.title,
    meetupDate: data.meetupDate,
    meetupTime: data.meetupTime,
    meetupLocation: data.meetupLocation,
    notes: data.notes ?? null,
  });
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

const DATE_REGEX = /^(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/\d{4}$/;
const TIME_REGEX = /^(0?[1-9]|1[0-2]):[0-5]\d\s?(AM|PM)$/i;
const MAX_NOTES = 2000;
const MAX_CHECKPOINTS = 30;

function parseSortDate(dateStr: string, timeStr: string): Date | null {
  try {
    const [month, day, year] = dateStr.split('/').map(Number);
    const match = timeStr.match(/^(\d{1,2}):(\d{2})\s?(AM|PM)$/i);
    if (!match) return null;
    let hours = parseInt(match[1]);
    const minutes = parseInt(match[2]);
    const ampm = match[3].toUpperCase();
    if (ampm === 'PM' && hours !== 12) hours += 12;
    if (ampm === 'AM' && hours === 12) hours = 0;
    return new Date(year, month - 1, day, hours, minutes);
  } catch { return null; }
}

function validateItem(data: { meetupDate?: string; meetupTime?: string; notes?: string }) {
  if (data.meetupDate && !DATE_REGEX.test(data.meetupDate))
    throw new AppError(400, 'VALIDATION_ERROR', 'meetupDate must be MM/DD/YYYY');
  if (data.meetupTime && !TIME_REGEX.test(data.meetupTime))
    throw new AppError(400, 'VALIDATION_ERROR', 'meetupTime must be HH:MM AM/PM (12-hour)');
  if (data.notes && data.notes.length > MAX_NOTES)
    throw new AppError(400, 'VALIDATION_ERROR', `notes max ${MAX_NOTES} characters`);
}

async function assertGroupMember(groupId: string, userId: string) {
  const m = await GroupMember.findOne({ where: { group_id: groupId, user_id: userId } });
  if (!m) throw new AppError(403, 'FORBIDDEN', 'Not a member of this group');
  return m;
}

async function assertGroupOwnerOrAdmin(groupId: string, userId: string) {
  const m = await assertGroupMember(groupId, userId);
  if (m.role !== 'owner' && m.role !== 'admin')
    throw new AppError(403, 'FORBIDDEN', 'Owner or admin role required');
  return m;
}

export async function createItem(groupId: string, userId: string, data: {
  title: string; meetupDate: string; meetupTime: string; meetupLocation: string;
  notes?: string; idempotencyKey: string;
}) {
  await assertGroupMember(groupId, userId);
  validateItem(data);

  // Idempotency lookup is strictly scoped to (group_id, created_by,
  // idempotency_key) so a key reused across groups or across users is
  // never matched as a "replay" of a foreign item. This matches the
  // composite unique index installed by migration 018.
  const existing = await ItineraryItem.findOne({
    where: {
      group_id: groupId,
      created_by: userId,
      idempotency_key: data.idempotencyKey,
    },
  });
  if (existing) {
    // Replay only if the request body matches the original. A repeat
    // request with the same key but a different payload is a 409 — it
    // signals client confusion, not a retry, and silently returning
    // the old item would lose data.
    const existingHash = hashCreateBody({
      title: existing.title,
      meetupDate: existing.meetup_date,
      meetupTime: existing.meetup_time,
      meetupLocation: existing.meetup_location,
      notes: existing.notes ?? undefined,
    });
    if (existingHash !== hashCreateBody(data)) {
      throw new AppError(
        409,
        'IDEMPOTENCY_CONFLICT',
        'Idempotency key already used with a different request body'
      );
    }
    return existing;
  }

  const t = await sequelize.transaction();
  try {
    const item = await ItineraryItem.create({
      id: uuidv4(), group_id: groupId, title: data.title,
      meetup_date: data.meetupDate, meetup_time: data.meetupTime,
      meetup_location: data.meetupLocation, notes: data.notes || null,
      meetup_sort_at: parseSortDate(data.meetupDate, data.meetupTime),
      created_by: userId, idempotency_key: data.idempotencyKey,
    }, { transaction: t });
    await t.commit();

    await emitNotification({
      groupId, actorId: userId, eventType: 'item_created',
      resourceType: 'itinerary_item', resourceId: item.id,
      detail: { title: data.title }, idempotencyKey: `item_created:${item.id}`,
    });
    return item;
  } catch (err) {
    await t.rollback();
    // If the unique index races (two concurrent identical requests
    // from the same scope), the second will hit the index and we
    // should re-fetch and replay rather than crash. Sequelize raises
    // SequelizeUniqueConstraintError for this case.
    const errName = (err as { name?: string })?.name;
    if (errName === 'SequelizeUniqueConstraintError') {
      const raced = await ItineraryItem.findOne({
        where: {
          group_id: groupId,
          created_by: userId,
          idempotency_key: data.idempotencyKey,
        },
      });
      if (raced) return raced;
    }
    throw err;
  }
}

export async function listItems(groupId: string, userId: string) {
  await assertGroupMember(groupId, userId);
  return ItineraryItem.findAll({
    where: { group_id: groupId },
    include: [{ model: ItineraryCheckpoint, as: 'checkpoints' }],
    order: [['meetup_sort_at', 'ASC'], ['created_at', 'ASC']],
  });
}

export async function getItem(groupId: string, itemId: string, userId: string) {
  await assertGroupMember(groupId, userId);
  const item = await ItineraryItem.findOne({
    where: { id: itemId, group_id: groupId },
    include: [
      { model: ItineraryCheckpoint, as: 'checkpoints', order: [['position', 'ASC']] },
      { model: MemberCheckin, as: 'checkins' },
    ],
  });
  if (!item) throw new AppError(404, 'NOT_FOUND', 'Itinerary item not found');
  return item;
}

export async function updateItem(groupId: string, itemId: string, userId: string, data: {
  title?: string; meetupDate?: string; meetupTime?: string; meetupLocation?: string;
  notes?: string; idempotencyKey: string;
}) {
  await assertGroupMember(groupId, userId);
  validateItem(data);

  // Update idempotency: scope is (key, actor, operation, resource_id).
  // `itemId` MUST be part of the lookup so the same idempotency key can
  // be reused by the same caller against a different itinerary item
  // without colliding with an earlier update of this item. See the
  // audit note in src/services/idempotency.service.ts.
  const replay = await checkIdempotency(data.idempotencyKey, userId, 'update_itinerary', itemId, data);
  if (replay) return replay as ItineraryItem;

  const item = await ItineraryItem.findOne({ where: { id: itemId, group_id: groupId } });
  if (!item) throw new AppError(404, 'NOT_FOUND', 'Itinerary item not found');

  const t = await sequelize.transaction();
  try {
    const updateData: Record<string, unknown> = {};
    if (data.title) updateData.title = data.title;
    if (data.meetupDate) updateData.meetup_date = data.meetupDate;
    if (data.meetupTime) updateData.meetup_time = data.meetupTime;
    if (data.meetupLocation) updateData.meetup_location = data.meetupLocation;
    if (data.notes !== undefined) updateData.notes = data.notes;
    const newDate = data.meetupDate || item.meetup_date;
    const newTime = data.meetupTime || item.meetup_time;
    updateData.meetup_sort_at = parseSortDate(newDate, newTime);

    await ItineraryItem.update(updateData, { where: { id: itemId }, transaction: t });
    await t.commit();

    await emitNotification({
      groupId, actorId: userId, eventType: 'item_updated',
      resourceType: 'itinerary_item', resourceId: itemId,
      detail: { fields: Object.keys(updateData) }, idempotencyKey: `item_updated:${itemId}:${Date.now()}`,
    });
    const result = await ItineraryItem.findByPk(itemId);
    await storeIdempotency(data.idempotencyKey, userId, 'update_itinerary', itemId, data, result?.toJSON());
    return result;
  } catch (err) { await t.rollback(); throw err; }
}

export async function deleteItem(groupId: string, itemId: string, userId: string) {
  await assertGroupOwnerOrAdmin(groupId, userId);
  const item = await ItineraryItem.findOne({ where: { id: itemId, group_id: groupId } });
  if (!item) throw new AppError(404, 'NOT_FOUND', 'Itinerary item not found');
  await ItineraryItem.destroy({ where: { id: itemId } });

  await emitNotification({
    groupId, actorId: userId, eventType: 'item_deleted',
    resourceType: 'itinerary_item', resourceId: itemId,
    detail: { title: item.title }, idempotencyKey: `item_deleted:${itemId}:${Date.now()}`,
  });
}

// --- Checkpoints ---
export async function addCheckpoint(groupId: string, itemId: string, userId: string, data: { label: string; position: number; description?: string }) {
  await assertGroupMember(groupId, userId);
  const item = await ItineraryItem.findOne({ where: { id: itemId, group_id: groupId } });
  if (!item) throw new AppError(404, 'NOT_FOUND', 'Itinerary item not found');

  const count = await ItineraryCheckpoint.count({ where: { item_id: itemId } });
  if (count >= MAX_CHECKPOINTS)
    throw new AppError(400, 'VALIDATION_ERROR', `Max ${MAX_CHECKPOINTS} checkpoints per item`);

  if (data.position < 1 || data.position > MAX_CHECKPOINTS)
    throw new AppError(400, 'VALIDATION_ERROR', `Position must be 1-${MAX_CHECKPOINTS}`);

  // Enforce unique position per item
  const conflict = await ItineraryCheckpoint.findOne({ where: { item_id: itemId, position: data.position } });
  if (conflict) throw new AppError(409, 'CONFLICT', `Position ${data.position} already occupied`);

  return ItineraryCheckpoint.create({
    id: uuidv4(), item_id: itemId, position: data.position,
    label: data.label, description: data.description || null, created_at: new Date(),
  });
}

export async function listCheckpoints(groupId: string, itemId: string, userId: string) {
  await assertGroupMember(groupId, userId);
  return ItineraryCheckpoint.findAll({ where: { item_id: itemId }, order: [['position', 'ASC']] });
}

export async function updateCheckpoint(groupId: string, itemId: string, checkpointId: string, userId: string, data: { label?: string; position?: number; description?: string }) {
  await assertGroupMember(groupId, userId);
  const cp = await ItineraryCheckpoint.findOne({ where: { id: checkpointId, item_id: itemId } });
  if (!cp) throw new AppError(404, 'NOT_FOUND', 'Checkpoint not found');
  const updateData: Record<string, unknown> = {};
  if (data.label) updateData.label = data.label;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.position !== undefined) {
    // Check position conflict
    const conflict = await ItineraryCheckpoint.findOne({ where: { item_id: itemId, position: data.position } });
    if (conflict && conflict.id !== checkpointId) throw new AppError(409, 'CONFLICT', `Position ${data.position} already occupied`);
    updateData.position = data.position;
  }
  await ItineraryCheckpoint.update(updateData, { where: { id: checkpointId } });
  return ItineraryCheckpoint.findByPk(checkpointId);
}

export async function deleteCheckpoint(groupId: string, itemId: string, checkpointId: string, userId: string) {
  await assertGroupOwnerOrAdmin(groupId, userId);
  const cp = await ItineraryCheckpoint.findOne({ where: { id: checkpointId, item_id: itemId } });
  if (!cp) throw new AppError(404, 'NOT_FOUND', 'Checkpoint not found');
  await ItineraryCheckpoint.destroy({ where: { id: checkpointId } });
}

// --- Check-in ---
export async function checkin(groupId: string, itemId: string, userId: string) {
  await assertGroupMember(groupId, userId);
  const item = await ItineraryItem.findOne({ where: { id: itemId, group_id: groupId } });
  if (!item) throw new AppError(404, 'NOT_FOUND', 'Itinerary item not found');

  // Check required fields
  const requiredFields = await GroupRequiredField.findAll({ where: { group_id: groupId, is_required: true } });
  if (requiredFields.length > 0) {
    const values = await MemberFieldValue.findAll({ where: { group_id: groupId, user_id: userId } });
    const valueMap = new Map(values.map(v => [v.field_name, v.value]));
    const missing = requiredFields.filter(f => !valueMap.has(f.field_name) || !valueMap.get(f.field_name)).map(f => f.field_name);
    if (missing.length > 0)
      throw new AppError(400, 'MISSING_REQUIRED_FIELDS', `Missing required fields: ${missing.join(', ')}`);
  }

  const existing = await MemberCheckin.findOne({ where: { item_id: itemId, user_id: userId } });
  if (existing) return existing;

  return MemberCheckin.create({ id: uuidv4(), item_id: itemId, user_id: userId, checked_in_at: new Date() });
}
