import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export interface ItineraryItemAttributes {
  id: string; group_id: string; title: string; meetup_date: string; meetup_time: string;
  meetup_location: string; notes: string | null; meetup_sort_at: Date | null;
  created_by: string; idempotency_key: string; created_at: Date; updated_at: Date;
}
export interface ItineraryItemCreation extends Optional<ItineraryItemAttributes, 'notes' | 'meetup_sort_at' | 'created_at' | 'updated_at'> {}

export class ItineraryItem extends Model<ItineraryItemAttributes, ItineraryItemCreation> implements ItineraryItemAttributes {
  public id!: string; public group_id!: string; public title!: string;
  public meetup_date!: string; public meetup_time!: string; public meetup_location!: string;
  public notes!: string | null; public meetup_sort_at!: Date | null; public created_by!: string;
  public idempotency_key!: string; public created_at!: Date; public updated_at!: Date;
}

ItineraryItem.init({
  id: { type: DataTypes.STRING(36), primaryKey: true },
  group_id: { type: DataTypes.STRING(36), allowNull: false },
  title: { type: DataTypes.STRING(255), allowNull: false },
  meetup_date: { type: DataTypes.STRING(10), allowNull: false },
  meetup_time: { type: DataTypes.STRING(8), allowNull: false },
  meetup_location: { type: DataTypes.TEXT, allowNull: false },
  notes: { type: DataTypes.TEXT, allowNull: true },
  meetup_sort_at: { type: DataTypes.DATE, allowNull: true },
  created_by: { type: DataTypes.STRING(36), allowNull: false },
  // idempotency_key is NOT globally unique. Uniqueness is enforced at
  // the DB layer by the composite index
  // (group_id, created_by, idempotency_key) — see migration 018. The
  // model declaration only enforces presence; the composite index is
  // declared in the model `indexes` option below to keep schema sync
  // (`sequelize.sync()` for tests) consistent with the migration.
  idempotency_key: { type: DataTypes.STRING(255), allowNull: false },
  created_at: { type: DataTypes.DATE, allowNull: false },
  updated_at: { type: DataTypes.DATE, allowNull: false },
}, {
  sequelize,
  tableName: 'itinerary_items',
  timestamps: true,
  underscored: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    {
      name: 'idx_itinerary_items_scope_idempotency',
      unique: true,
      fields: ['group_id', 'created_by', 'idempotency_key'],
    },
  ],
});

export interface CheckpointAttributes {
  id: string; item_id: string; position: number; label: string; description: string | null; created_at: Date;
}
export class ItineraryCheckpoint extends Model<CheckpointAttributes, Optional<CheckpointAttributes, 'description' | 'created_at'>> implements CheckpointAttributes {
  public id!: string; public item_id!: string; public position!: number;
  public label!: string; public description!: string | null; public created_at!: Date;
}
ItineraryCheckpoint.init({
  id: { type: DataTypes.STRING(36), primaryKey: true },
  item_id: { type: DataTypes.STRING(36), allowNull: false },
  position: { type: DataTypes.INTEGER, allowNull: false },
  label: { type: DataTypes.STRING(255), allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: true },
  created_at: { type: DataTypes.DATE, allowNull: false },
}, { sequelize, tableName: 'itinerary_checkpoints', timestamps: false, underscored: true });

export interface MemberCheckinAttributes {
  id: string; item_id: string; user_id: string; checked_in_at: Date;
}
export class MemberCheckin extends Model<MemberCheckinAttributes, Optional<MemberCheckinAttributes, 'checked_in_at'>> implements MemberCheckinAttributes {
  public id!: string; public item_id!: string; public user_id!: string; public checked_in_at!: Date;
}
MemberCheckin.init({
  id: { type: DataTypes.STRING(36), primaryKey: true },
  item_id: { type: DataTypes.STRING(36), allowNull: false },
  user_id: { type: DataTypes.STRING(36), allowNull: false },
  checked_in_at: { type: DataTypes.DATE, allowNull: false },
}, { sequelize, tableName: 'member_checkins', timestamps: false, underscored: true });

ItineraryItem.hasMany(ItineraryCheckpoint, { foreignKey: 'item_id', as: 'checkpoints' });
ItineraryItem.hasMany(MemberCheckin, { foreignKey: 'item_id', as: 'checkins' });
