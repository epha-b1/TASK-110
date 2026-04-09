import { Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import ExcelJS from 'exceljs';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import * as reportingService from '../services/reporting.service';
import { AuditLog } from '../models/audit.model';
import { ExportRecord } from '../models/export.model';
import { AppError } from '../utils/errors';
import { traceStore } from '../utils/logger';
import { objectsToCsv } from '../utils/csv';

function getManagerScope(req: AuthenticatedRequest): string | undefined {
  if (req.user!.role === 'manager') {
    if (!req.user!.propertyId) throw new AppError(403, 'FORBIDDEN', 'Manager must be assigned to a property');
    if (req.query.propertyId && req.query.propertyId !== req.user!.propertyId)
      throw new AppError(403, 'FORBIDDEN', 'Access denied to this property');
    return req.user!.propertyId;
  }
  return undefined;
}

/**
 * Serialize a list of report rows to a CSV string suitable for writing
 * to disk. Extracted from exportReport so the safety properties (RFC
 * 4180 quoting + formula injection neutralization) can be unit-tested
 * without spinning up the full controller.
 *
 * Returns an empty string when there are no rows so the caller can
 * still create an empty file.
 */
export function serializeReportRowsToCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const columns = Object.keys(rows[0]);
  return objectsToCsv(rows, columns);
}

export async function occupancy(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const scope = getManagerScope(req);
    res.json(await reportingService.occupancy({ propertyId: req.query.propertyId as string, from: req.query.from as string, to: req.query.to as string, groupBy: req.query.groupBy as string, roomType: req.query.roomType as string }, scope));
  } catch (e) { next(e); }
}

export async function adr(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const scope = getManagerScope(req);
    res.json(await reportingService.adr({ propertyId: req.query.propertyId as string, from: req.query.from as string, to: req.query.to as string, groupBy: req.query.groupBy as string }, scope));
  } catch (e) { next(e); }
}

export async function revpar(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const scope = getManagerScope(req);
    res.json(await reportingService.revpar({ propertyId: req.query.propertyId as string, from: req.query.from as string, to: req.query.to as string, groupBy: req.query.groupBy as string }, scope));
  } catch (e) { next(e); }
}

export async function revenueMix(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const scope = getManagerScope(req);
    res.json(await reportingService.revenueMix({ propertyId: req.query.propertyId as string, from: req.query.from as string, to: req.query.to as string, groupBy: req.query.groupBy as string }, scope));
  } catch (e) { next(e); }
}

export async function exportReport(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const scope = getManagerScope(req);
    const { reportType, from, to, format, groupBy, propertyId, includePii } = req.body;

    if (includePii) {
      const { User } = require('../models/user.model');
      const user = await User.findByPk(req.user!.id);
      if (!user?.pii_export_allowed) throw new AppError(403, 'FORBIDDEN', 'PII export not permitted');
    }

    let data: unknown[];
    switch (reportType) {
      case 'occupancy': data = await reportingService.occupancy({ propertyId, from, to, groupBy }, scope); break;
      case 'adr': data = await reportingService.adr({ propertyId, from, to, groupBy }, scope); break;
      case 'revpar': data = await reportingService.revpar({ propertyId, from, to, groupBy }, scope); break;
      case 'revenue_mix': data = await reportingService.revenueMix({ propertyId, from, to, groupBy }, scope); break;
      default: throw new AppError(400, 'VALIDATION_ERROR', 'Invalid reportType');
    }

    const exportId = uuidv4();
    const rows = data as Record<string, unknown>[];
    let filename: string;
    let filePath: string;

    if (format === 'excel') {
      filename = `report-${reportType}-${exportId}.xlsx`;
      filePath = path.resolve('exports', filename);
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet(reportType);
      if (rows.length > 0) {
        ws.addRow(Object.keys(rows[0]));
        for (const row of rows) ws.addRow(Object.values(row));
      }
      await wb.xlsx.writeFile(filePath);
    } else {
      // CSV — serialized via serializeReportRowsToCsv → objectsToCsv so
      // every cell is properly quoted (commas / newlines / embedded
      // quotes) and values that begin with formula-trigger characters
      // (=, +, -, @) are neutralized against spreadsheet formula
      // injection. See src/utils/csv.ts.
      filename = `report-${reportType}-${exportId}.csv`;
      filePath = path.resolve('exports', filename);
      fs.writeFileSync(filePath, serializeReportRowsToCsv(rows));
    }

    // Log export metadata to audit_logs
    await AuditLog.create({
      id: uuidv4(),
      actor_id: req.user!.id,
      action: 'report_export',
      resource_type: 'report',
      resource_id: exportId,
      detail: { reportType, from, to, format, groupBy, propertyId, includePii: !!includePii, rowCount: rows.length },
      trace_id: traceStore.getStore()?.traceId || null,
      ip_address: req.ip || null,
      created_at: new Date(),
    });

    // Register export ownership
    await ExportRecord.create({
      id: exportId, user_id: req.user!.id, filename,
      export_type: 'report',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
      created_at: new Date(),
    });

    res.json({ downloadUrl: `/exports/${filename}`, format: format === 'excel' ? 'xlsx' : 'csv' });
  } catch (e) { next(e); }
}
