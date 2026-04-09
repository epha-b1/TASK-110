import fs from 'fs';
import os from 'os';
import path from 'path';

describe('import-tmp hygiene', () => {
  // cleanupStaleImportTmp() reads var/import-tmp relative to cwd. We
  // simulate that directory in the test so no real project state is
  // touched. Snapshots the original cwd and restores it after each test.
  let workdir: string;
  let originalCwd: string;

  beforeEach(() => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-tmp-test-'));
    fs.mkdirSync(path.join(workdir, 'var/import-tmp'), { recursive: true });
    originalCwd = process.cwd();
    process.chdir(workdir);
    // Clear the module cache so IMPORT_TMP_DIR is re-resolved against
    // the new (temp) cwd when we require the module.
    jest.resetModules();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  test('deletes .import-*.json files older than maxAge', () => {
    const tmp = path.join(workdir, 'var/import-tmp');
    const staleFile = path.join(tmp, '.import-old.json');
    fs.writeFileSync(staleFile, '{}');
    // Backdate mtime by 2 days
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    fs.utimesSync(staleFile, twoDaysAgo, twoDaysAgo);

    const { cleanupStaleImportTmp } = require('../src/services/import.service');
    const deleted = cleanupStaleImportTmp(24 * 60 * 60 * 1000);
    expect(deleted).toBe(1);
    expect(fs.existsSync(staleFile)).toBe(false);
  });

  test('preserves recent files', () => {
    const tmp = path.join(workdir, 'var/import-tmp');
    const recent = path.join(tmp, '.import-recent.json');
    fs.writeFileSync(recent, '{}');

    const { cleanupStaleImportTmp } = require('../src/services/import.service');
    const deleted = cleanupStaleImportTmp(24 * 60 * 60 * 1000);
    expect(deleted).toBe(0);
    expect(fs.existsSync(recent)).toBe(true);
  });

  test('ignores files that do not match the import pattern', () => {
    const tmp = path.join(workdir, 'var/import-tmp');
    const other = path.join(tmp, 'some-other-file.txt');
    fs.writeFileSync(other, 'x');
    // Backdate mtime far into the past
    fs.utimesSync(other, new Date(0), new Date(0));

    const { cleanupStaleImportTmp } = require('../src/services/import.service');
    const deleted = cleanupStaleImportTmp(24 * 60 * 60 * 1000);
    expect(deleted).toBe(0);
    expect(fs.existsSync(other)).toBe(true);
  });

  test('no-op when tmp dir does not exist', () => {
    fs.rmSync(path.join(workdir, 'var/import-tmp'), { recursive: true });
    const { cleanupStaleImportTmp } = require('../src/services/import.service');
    const deleted = cleanupStaleImportTmp();
    expect(deleted).toBe(0);
  });

  // ----- Determinism + isolation regression guards ----------------------

  test('IMPORT_TMP_SUBDIR is var/import-tmp — never under exports/', () => {
    const { IMPORT_TMP_SUBDIR, getImportTmpDir } = require('../src/services/import.service');
    expect(IMPORT_TMP_SUBDIR).toBe('var/import-tmp');
    // The resolved absolute path must not contain the exports/ segment.
    // This is the core data-leak guard: even a future refactor that
    // hardcoded a path under exports/ would break this assertion.
    const resolved = getImportTmpDir();
    expect(resolved).not.toMatch(/[\\\/]exports[\\\/]/);
    expect(resolved).toMatch(/[\\\/]var[\\\/]import-tmp$/);
  });

  test('tmpFilePath rejects non-UUID batch ids', () => {
    const { tmpFilePath } = require('../src/services/import.service');
    expect(() => tmpFilePath('../etc/passwd')).toThrow(/Invalid batch id/);
    expect(() => tmpFilePath('not-a-uuid')).toThrow(/Invalid batch id/);
    expect(() => tmpFilePath('')).toThrow(/Invalid batch id/);
    expect(() => tmpFilePath('00000000-0000-0000-0000-000000000000/../escape')).toThrow(/Invalid batch id/);
  });

  test('tmpFilePath accepts valid UUID and resolves under tmp dir', () => {
    const { tmpFilePath, getImportTmpDir } = require('../src/services/import.service');
    const id = '0123abcd-4567-8901-abcd-ef0123456789';
    const full = tmpFilePath(id);
    expect(full).toBe(path.join(getImportTmpDir(), `.import-${id}.json`));
    expect(full.startsWith(getImportTmpDir() + path.sep)).toBe(true);
  });

  test('cleanup is idempotent — second call deletes nothing', () => {
    const tmp = path.join(workdir, 'var/import-tmp');
    const stale = path.join(tmp, '.import-once.json');
    fs.writeFileSync(stale, '{}');
    fs.utimesSync(stale, new Date(0), new Date(0));

    const { cleanupStaleImportTmp } = require('../src/services/import.service');
    expect(cleanupStaleImportTmp()).toBe(1);
    expect(cleanupStaleImportTmp()).toBe(0); // idempotent
    expect(fs.existsSync(stale)).toBe(false);
  });

  test('cleanup never recurses into subdirectories', () => {
    const tmp = path.join(workdir, 'var/import-tmp');
    const subdir = path.join(tmp, '.import-subdir.json'); // matches name pattern
    fs.mkdirSync(subdir);
    fs.utimesSync(subdir, new Date(0), new Date(0));

    const { cleanupStaleImportTmp } = require('../src/services/import.service');
    const deleted = cleanupStaleImportTmp();
    // The directory matches the name pattern but is NOT a regular file —
    // cleanup must skip it rather than crash on unlink or recurse into it.
    expect(deleted).toBe(0);
    expect(fs.existsSync(subdir)).toBe(true);
    expect(fs.statSync(subdir).isDirectory()).toBe(true);
  });

  test('cleanup ignores files outside the tmp dir even with --import-* names', () => {
    // Place a stale .import-* file in workdir/exports/ (NOT in var/import-tmp).
    const fakeExports = path.join(workdir, 'exports');
    fs.mkdirSync(fakeExports, { recursive: true });
    const phantom = path.join(fakeExports, '.import-phantom.json');
    fs.writeFileSync(phantom, '{}');
    fs.utimesSync(phantom, new Date(0), new Date(0));

    const { cleanupStaleImportTmp } = require('../src/services/import.service');
    cleanupStaleImportTmp();

    // The file in exports/ must remain — cleanup is scoped strictly to
    // var/import-tmp. (cleanupExports in jobs/cleanup.ts handles the
    // legacy exports/ case separately.)
    expect(fs.existsSync(phantom)).toBe(true);
  });

  test('uploadAndValidate would write under var/import-tmp (path computed via tmpFilePath)', () => {
    const { tmpFilePath, getImportTmpDir } = require('../src/services/import.service');
    const dir = getImportTmpDir();
    const id = '11111111-2222-3333-4444-555555555555';
    const writePath = tmpFilePath(id);
    expect(path.dirname(writePath)).toBe(dir);
    // Sibling assertion: the path's parent must NOT be exports/.
    expect(path.dirname(writePath)).not.toMatch(/exports$/);
  });
});
