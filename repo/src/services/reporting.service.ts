import { QueryTypes } from 'sequelize';
import { sequelize } from '../config/database';

/**
 * Reporting service — room-night-correct KPIs
 *
 * The original implementation counted reservations rather than room
 * nights, which produced wrong results for any reservation that spanned
 * more than one night. The audit flagged this as a fundamental
 * correctness defect.
 *
 * Definitions used here, MySQL 8 + recursive CTE:
 *
 *   night                — a single calendar date in the [from, to]
 *                          inclusive range
 *   available_room_night — one (room, date) pair where the room is NOT
 *                          in `maintenance` status
 *   occupied_room_night  — one (room, date) pair covered by a
 *                          non-cancelled reservation, where the date
 *                          satisfies date >= check_in_date AND
 *                          date <  check_out_date
 *                          (check_in inclusive, check_out exclusive)
 *   revenue_cents        — sum of nightly rate_cents across the
 *                          occupied_room_nights set
 *
 *   Occupancy = SUM(occupied) / SUM(available)
 *   ADR       = SUM(revenue)  / SUM(occupied)
 *   RevPAR    = SUM(revenue)  / SUM(available)
 *
 * Manager scope: when a managerPropertyId is supplied (set by the
 * controller from req.user.propertyId), it overrides any caller-supplied
 * propertyId so a manager cannot peek into other properties.
 *
 * The result set is grouped by the requested rollup (day/week/month);
 * the underlying per-night facts are computed in a single CTE-backed
 * query so day/week/month all share the same source of truth.
 */

interface ReportParams {
  propertyId?: string;
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD inclusive
  groupBy?: string;
  roomType?: string;
}

const NON_CANCELLED_STATUSES = "('confirmed','checked_in','checked_out')";

function effectivePropertyId(params: ReportParams, managerPropertyId?: string): string | undefined {
  return managerPropertyId || params.propertyId || undefined;
}

function periodExpr(groupBy?: string): string {
  switch (groupBy) {
    case 'week':  return "DATE_FORMAT(night, '%x-W%v')";
    case 'month': return "DATE_FORMAT(night, '%Y-%m')";
    default:      return "DATE_FORMAT(night, '%Y-%m-%d')";
  }
}

/**
 * Build the per-night fact CTE shared by all three KPIs. Returns the
 * SQL fragment plus the positional replacements that go with it.
 */
function buildPerNightCte(params: ReportParams, managerPropertyId?: string): { sql: string; replacements: unknown[] } {
  const propId = effectivePropertyId(params, managerPropertyId);
  const replacements: unknown[] = [];

  // Anchor + recursive step uses :from and :to placeholders inlined as
  // positional `?`. We push the from/to twice because the available
  // and occupied subqueries each reference the calendar separately —
  // but we factor the calendar into a single CTE so we only need from/to once.
  replacements.push(params.from);  // calendar anchor
  replacements.push(params.to);    // calendar termination guard

  // Available room-nights filter
  let availableWhere = "rm.status <> 'maintenance'";
  if (propId)         { availableWhere += ' AND rm.property_id = ?'; replacements.push(propId); }
  if (params.roomType){ availableWhere += ' AND rm.room_type   = ?'; replacements.push(params.roomType); }

  // Occupied room-nights filter
  let occupiedWhere = `res.status IN ${NON_CANCELLED_STATUSES} AND rm.status <> 'maintenance'`;
  if (propId)          { occupiedWhere += ' AND rm.property_id = ?'; replacements.push(propId); }
  if (params.roomType) { occupiedWhere += ' AND rm.room_type   = ?'; replacements.push(params.roomType); }

  const sql = `
    WITH RECURSIVE calendar (night) AS (
      SELECT DATE(?)
      UNION ALL
      SELECT DATE_ADD(night, INTERVAL 1 DAY)
      FROM calendar
      WHERE night < DATE(?)
    ),
    available AS (
      SELECT cal.night AS night, COUNT(*) AS available_rooms
      FROM calendar cal
      CROSS JOIN rooms rm
      WHERE ${availableWhere}
      GROUP BY cal.night
    ),
    occupied AS (
      SELECT cal.night AS night,
             COUNT(*) AS occupied_rooms,
             COALESCE(SUM(res.rate_cents), 0) AS revenue_cents
      FROM calendar cal
      JOIN reservations res
        ON cal.night >= res.check_in_date
       AND cal.night <  res.check_out_date
      JOIN rooms rm
        ON rm.id = res.room_id
      WHERE ${occupiedWhere}
      GROUP BY cal.night
    ),
    per_night AS (
      SELECT a.night AS night,
             a.available_rooms AS available_rooms,
             COALESCE(o.occupied_rooms, 0) AS occupied_rooms,
             COALESCE(o.revenue_cents, 0) AS revenue_cents
      FROM available a
      LEFT JOIN occupied o ON o.night = a.night
    )
  `;

  return { sql, replacements };
}

export async function occupancy(params: ReportParams, managerPropertyId?: string) {
  const cte = buildPerNightCte(params, managerPropertyId);
  const period = periodExpr(params.groupBy);
  const sql = `${cte.sql}
    SELECT ${period} AS period,
           SUM(available_rooms) AS available_room_nights,
           SUM(occupied_rooms)  AS occupied_room_nights,
           ROUND(SUM(occupied_rooms) / NULLIF(SUM(available_rooms), 0), 4) AS occupancy_rate
    FROM per_night
    GROUP BY period
    ORDER BY period`;
  return sequelize.query(sql, { replacements: cte.replacements, type: QueryTypes.SELECT });
}

export async function adr(params: ReportParams, managerPropertyId?: string) {
  const cte = buildPerNightCte(params, managerPropertyId);
  const period = periodExpr(params.groupBy);
  const sql = `${cte.sql}
    SELECT ${period} AS period,
           SUM(revenue_cents) AS revenue_cents,
           SUM(occupied_rooms) AS occupied_room_nights,
           ROUND(SUM(revenue_cents) / NULLIF(SUM(occupied_rooms), 0), 2) AS adr_cents
    FROM per_night
    GROUP BY period
    ORDER BY period`;
  return sequelize.query(sql, { replacements: cte.replacements, type: QueryTypes.SELECT });
}

export async function revpar(params: ReportParams, managerPropertyId?: string) {
  const cte = buildPerNightCte(params, managerPropertyId);
  const period = periodExpr(params.groupBy);
  const sql = `${cte.sql}
    SELECT ${period} AS period,
           SUM(revenue_cents) AS revenue_cents,
           SUM(available_rooms) AS available_room_nights,
           ROUND(SUM(revenue_cents) / NULLIF(SUM(available_rooms), 0), 2) AS revpar_cents
    FROM per_night
    GROUP BY period
    ORDER BY period`;
  return sequelize.query(sql, { replacements: cte.replacements, type: QueryTypes.SELECT });
}

/**
 * Revenue mix: total revenue partitioned by either room_type or
 * channel. Uses the same per-night CTE so revenue numbers are
 * consistent with the room-night KPIs above (no double counting).
 */
export async function revenueMix(params: ReportParams, managerPropertyId?: string) {
  const propId = effectivePropertyId(params, managerPropertyId);
  const replacements: unknown[] = [];
  replacements.push(params.from);
  replacements.push(params.to);

  let scopeWhere = `res.status IN ${NON_CANCELLED_STATUSES} AND rm.status <> 'maintenance'`;
  if (propId) { scopeWhere += ' AND rm.property_id = ?'; replacements.push(propId); }

  // groupBy defines the partition column. Allow only safe values to
  // avoid SQL injection through `groupBy`.
  const groupCol = params.groupBy === 'room_type' ? 'rm.room_type' : 'res.channel';

  const sql = `
    WITH RECURSIVE calendar (night) AS (
      SELECT DATE(?)
      UNION ALL
      SELECT DATE_ADD(night, INTERVAL 1 DAY)
      FROM calendar
      WHERE night < DATE(?)
    )
    SELECT ${groupCol} AS category,
           SUM(res.rate_cents) AS total_revenue,
           COUNT(*) AS room_nights
    FROM calendar cal
    JOIN reservations res
      ON cal.night >= res.check_in_date
     AND cal.night <  res.check_out_date
    JOIN rooms rm
      ON rm.id = res.room_id
    WHERE ${scopeWhere}
    GROUP BY category
    ORDER BY total_revenue DESC`;

  return sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
}
