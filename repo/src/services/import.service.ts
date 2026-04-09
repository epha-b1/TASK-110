import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';
import { QueryTypes } from 'sequelize';
import { ImportBatch, ImportError, StaffingRecord, EvaluationRecord } from '../models/import.model';
import { AppError } from '../utils/errors';
import { sequelize } from '../config/database';
import { traceStore, createCategoryLogger } from '../utils/logger';

const logger = createCategoryLogger('import');

// Dedicated staging directory for validated-but-not-yet-committed import
// rows. This directory MUST be isolated from exports/ so that temp
// artifacts (which may contain PII) never leak into the download path.
// The directory is auto-created on first use and all files written here
// follow the `.import-<batchId>.json` naming convention.
//
// Why a getter, not a const? Tests change `process.cwd()` to a temp dir
// to exercise cleanup in isolation. A captured-once `path.resolve` would
// freeze the path at module load time and be wrong inside those tests.
// Production code only ever calls this once per request so the small
// overhead is irrelevant.
export const IMPORT_TMP_SUBDIR = 'var/import-tmp';
export function getImportTmpDir(): string {
  return path.resolve(IMPORT_TMP_SUBDIR);
}

function ensureTmpDir(): void {
  const dir = getImportTmpDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * Build the absolute filesystem path for a batch's staging file. Two
 * defenses against path injection:
 *   1) batchId must match the UUID v4 lexical shape — anything else
 *      throws a 400 immediately.
 *   2) the resolved path must start with the staging directory + sep,
 *      so any clever escape (e.g. embedded `..`) cannot escape the
 *      sandbox even if it satisfied the regex.
 *
 * Exported for unit testing — production callers should not need to
 * import it directly.
 */
export function tmpFilePath(batchId: string): string {
  if (!/^[0-9a-fA-F-]{36}$/.test(batchId)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid batch id');
  }
  const dir = getImportTmpDir();
  const full = path.resolve(dir, `.import-${batchId}.json`);
  if (!full.startsWith(dir + path.sep)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid batch id');
  }
  return full;
}

const STAFFING_COLUMNS = ['employee_id', 'effective_date', 'position', 'department', 'property_id', 'signed_off_by'];
const STAFFING_REQUIRED = ['employee_id', 'effective_date', 'position'];
const EVAL_COLUMNS = ['employee_id', 'effective_date', 'score', 'result', 'rewards', 'penalties', 'signed_off_by'];
const EVAL_REQUIRED = ['employee_id', 'effective_date', 'score', 'result'];
const MAX_RETRY_ATTEMPTS = 3;

export async function getTemplate(datasetType: string): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(datasetType);
  ws.addRow(datasetType === 'staffing' ? STAFFING_COLUMNS : EVAL_COLUMNS);
  return wb;
}

function parseRows(ws: ExcelJS.Worksheet, headers: string[], datasetType: string) {
  const errors: { rowNumber: number; field: string | null; reason: string }[] = [];
  const validRows: Record<string, string>[] = [];
  const required = datasetType === 'staffing' ? STAFFING_REQUIRED : EVAL_REQUIRED;

  ws.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    const data: Record<string, string> = {};
    headers.forEach((h, i) => { data[h] = row.getCell(i + 1).text?.trim() || ''; });

    let hasError = false;
    for (const req of required) {
      if (!data[req]) { errors.push({ rowNumber: rowNum, field: req, reason: `${req} is required` }); hasError = true; }
    }
    if (data.effective_date && !/^\d{4}-\d{2}-\d{2}$/.test(data.effective_date)) {
      errors.push({ rowNumber: rowNum, field: 'effective_date', reason: 'Must be YYYY-MM-DD' }); hasError = true;
    }
    if (datasetType === 'evaluation' && data.score && isNaN(Number(data.score))) {
      errors.push({ rowNumber: rowNum, field: 'score', reason: 'Must be a number' }); hasError = true;
    }
    if (!hasError) validRows.push(data);
  });

  return { errors, validRows, totalRows: validRows.length + errors.length };
}

export async function uploadAndValidate(userId: string, datasetType: string, buffer: Buffer) {
  const batchId = uuidv4();
  const traceId = traceStore.getStore()?.traceId || null;

  const batch = await ImportBatch.create({
    id: batchId, user_id: userId, batch_type: datasetType,
    status: 'pending', trace_id: traceId, created_at: new Date(),
  });

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new AppError(400, 'VALIDATION_ERROR', 'No worksheet found');

  const headers = (ws.getRow(1).values as string[]).slice(1).map(h => String(h).trim().toLowerCase());
  const required = datasetType === 'staffing' ? STAFFING_REQUIRED : EVAL_REQUIRED;
  const missing = required.filter(r => !headers.includes(r));
  if (missing.length > 0) throw new AppError(400, 'VALIDATION_ERROR', `Missing required columns: ${missing.join(', ')}`);

  const { errors, validRows, totalRows } = parseRows(ws, headers, datasetType);

  for (const err of errors) {
    await ImportError.create({ id: uuidv4(), batch_id: batchId, row_number: err.rowNumber, field: err.field, reason: err.reason });
  }

  // Store valid rows as JSON in batch for commit phase
  await ImportBatch.update({
    total_rows: totalRows, error_rows: errors.length,
    success_rows: validRows.length, status: 'pending',
  }, { where: { id: batchId } });

  // Stage validated rows to the isolated import-tmp dir for the commit phase.
  // Files live under var/import-tmp only — never exports/ — so raw PII
  // cannot leak through the download endpoint.
  if (validRows.length > 0) {
    ensureTmpDir();
    fs.writeFileSync(tmpFilePath(batchId), JSON.stringify({ datasetType, validRows }));
  }

  return { batchId, totalRows, validRows: validRows.length, errorRows: errors.length, errors };
}

export async function commitBatch(batchId: string, userId: string) {
  const batch = await ImportBatch.findByPk(batchId);
  if (!batch) throw new AppError(404, 'NOT_FOUND', 'Batch not found');
  if (batch.user_id !== userId) throw new AppError(403, 'FORBIDDEN', 'Not authorized for this batch');
  if (batch.status === 'completed') throw new AppError(409, 'CONFLICT', 'Already committed');
  if (batch.status === 'failed') throw new AppError(409, 'CONFLICT', 'Batch failed');

  const dataPath = tmpFilePath(batchId);

  let datasetType: string;
  let validRows: Record<string, string>[];
  try {
    const raw = fs.readFileSync(dataPath, 'utf8');
    const parsed = JSON.parse(raw);
    datasetType = parsed.datasetType;
    validRows = parsed.validRows;
  } catch {
    // No valid rows to commit
    await ImportBatch.update({ status: 'completed', completed_at: new Date() }, { where: { id: batchId } });
    return ImportBatch.findByPk(batchId);
  }

  let attempt = 0;
  while (attempt < MAX_RETRY_ATTEMPTS) {
    attempt++;
    const t = await sequelize.transaction();
    try {
      await ImportBatch.update({ status: 'processing' }, { where: { id: batchId }, transaction: t });

      let inserted = 0;
      for (const row of validRows) {
        if (datasetType === 'staffing') {
          // Upsert by (employee_id, effective_date)
          const existing = await StaffingRecord.findOne({
            where: { employee_id: row.employee_id, effective_date: row.effective_date },
            transaction: t,
          });
          if (existing) {
            await StaffingRecord.update({
              position: row.position,
              department: row.department || null,
              property_id: row.property_id || null,
              signed_off_by: row.signed_off_by || null,
              batch_id: batchId,
            }, { where: { id: existing.id }, transaction: t });
          } else {
            await StaffingRecord.create({
              id: uuidv4(), batch_id: batchId,
              employee_id: row.employee_id, effective_date: row.effective_date,
              position: row.position, department: row.department || null,
              property_id: row.property_id || null, signed_off_by: row.signed_off_by || null,
              created_at: new Date(),
            }, { transaction: t });
          }
          inserted++;
        } else {
          // evaluation — upsert by (employee_id, effective_date)
          const existing = await EvaluationRecord.findOne({
            where: { employee_id: row.employee_id, effective_date: row.effective_date },
            transaction: t,
          });
          if (existing) {
            await EvaluationRecord.update({
              score: row.score ? Number(row.score) : null,
              result: row.result || null,
              rewards: row.rewards || null,
              penalties: row.penalties || null,
              signed_off_by: row.signed_off_by || null,
              batch_id: batchId,
            }, { where: { id: existing.id }, transaction: t });
          } else {
            await EvaluationRecord.create({
              id: uuidv4(), batch_id: batchId,
              employee_id: row.employee_id, effective_date: row.effective_date,
              score: row.score ? Number(row.score) : null, result: row.result || null,
              rewards: row.rewards || null, penalties: row.penalties || null,
              signed_off_by: row.signed_off_by || null, created_at: new Date(),
            }, { transaction: t });
          }
          inserted++;
        }
      }

      await ImportBatch.update({
        status: 'completed', completed_at: new Date(), success_rows: inserted,
      }, { where: { id: batchId }, transaction: t });

      await t.commit();
      try { fs.unlinkSync(dataPath); } catch { /* ok */ }
      logger.info('Import batch committed', { batchId, attempt, inserted });
      return ImportBatch.findByPk(batchId);
    } catch (err) {
      await t.rollback();
      if (attempt >= MAX_RETRY_ATTEMPTS) {
        await ImportBatch.update({ status: 'failed' }, { where: { id: batchId } });
        // Delete the staged temp file even on failure so PII does not linger.
        try { fs.unlinkSync(dataPath); } catch { /* already gone */ }
        logger.error('Import batch failed after max retries', { batchId, attempt });
        throw err;
      }
      const delay = Math.pow(2, attempt - 1) * 1000;
      logger.warn('Import batch retry', { batchId, attempt, delayMs: delay });
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

export async function getBatch(batchId: string, userId: string) {
  const batch = await ImportBatch.findByPk(batchId, { include: [{ model: ImportError, as: 'errors' }] });
  if (!batch) throw new AppError(404, 'NOT_FOUND', 'Batch not found');
  if (batch.user_id !== userId) throw new AppError(403, 'FORBIDDEN', 'Not authorized for this batch');
  return batch;
}

/**
 * Remove stale import temp files that were written but never committed.
 * A file is stale when its mtime is older than `maxAgeMs` (default 24h).
 * Returns the number of files deleted. Safe to call with a missing tmp dir.
 *
 * Deterministic behavior:
 *   - Only files whose name starts with `.import-` AND ends with `.json`
 *     are considered. Anything else in the directory is left alone.
 *   - Each file's age is computed from its mtime against the same cutoff
 *     so the result is independent of iteration order.
 *   - The function never traverses into subdirectories (no recursion).
 */
export function cleanupStaleImportTmp(maxAgeMs: number = 24 * 60 * 60 * 1000): number {
  const dir = getImportTmpDir();
  if (!fs.existsSync(dir)) return 0;
  const cutoff = Date.now() - maxAgeMs;
  let deleted = 0;
  for (const name of fs.readdirSync(dir)) {
    // Only touch files that match the batch temp pattern — never other
    // files that may land here by accident.
    if (!name.startsWith('.import-') || !name.endsWith('.json')) continue;
    const full = path.join(dir, name);
    try {
      const stat = fs.statSync(full);
      // Skip directories defensively — readdirSync returns names only
      // and we never recurse, but a same-named dir would otherwise be
      // unlinked.
      if (!stat.isFile()) continue;
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(full);
        deleted++;
      }
    } catch { /* already gone */ }
  }
  return deleted;
}

export async function staffingReport(params: { propertyId?: string; from?: string; to?: string }) {
  const clauses: string[] = [];
  const replacements: string[] = [];
  if (params.propertyId) { clauses.push('s.property_id = ?'); replacements.push(params.propertyId); }
  if (params.from) { clauses.push('s.effective_date >= ?'); replacements.push(params.from); }
  if (params.to) { clauses.push('s.effective_date <= ?'); replacements.push(params.to); }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';

  const distribution = await sequelize.query(
    `SELECT position, COUNT(*) as count FROM staffing_records s ${where} GROUP BY position ORDER BY count DESC`,
    { replacements, type: QueryTypes.SELECT }
  );
  return { positionDistribution: distribution };
}

export async function evaluationReport(params: { propertyId?: string; from?: string; to?: string }) {
  // Evaluation records do not carry property_id directly; the property an
  // employee belongs to is derived from their staffing records. When a
  // property scope is supplied (manager path or explicit propertyId query
  // parameter), we filter evaluations down to employees who have at least
  // one staffing row on that property. This mirrors the strictness of
  // staffingReport's property filter and closes the manager isolation gap
  // reported in the static audit.
  const clauses: string[] = [];
  const replacements: (string | number)[] = [];
  if (params.propertyId) {
    clauses.push(
      'EXISTS (SELECT 1 FROM staffing_records s WHERE s.employee_id = e.employee_id AND s.property_id = ?)'
    );
    replacements.push(params.propertyId);
  }
  if (params.from) { clauses.push('e.effective_date >= ?'); replacements.push(params.from); }
  if (params.to) { clauses.push('e.effective_date <= ?'); replacements.push(params.to); }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';

  const summary = await sequelize.query(
    `SELECT result, COUNT(*) as count, AVG(score) as avg_score FROM evaluation_records e ${where} GROUP BY result ORDER BY count DESC`,
    { replacements, type: QueryTypes.SELECT }
  );
  return { resultsSummary: summary };
}
