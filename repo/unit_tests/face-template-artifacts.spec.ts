/**
 * Guard test — no encrypted face template artifacts may be COMMITTED
 * to the repository. Face templates contain biometric material and
 * are written to `face-templates/` as a runtime side effect of
 * enrollment; they must never be checked in.
 *
 * The audit flagged `.enc` files committed alongside `.gitkeep`. This
 * test enforces the fix by inspecting `git ls-files face-templates/`
 * and asserting only the `.gitkeep` sentinel is tracked. Combined with
 * the `.gitignore` rule (`face-templates/*` + `!face-templates/.gitkeep`)
 * it provides defense in depth against accidental commits.
 *
 * Important: this test checks GIT-TRACKED state, not the working
 * filesystem. Running the API test suite legitimately creates `.enc`
 * files in `face-templates/` as a runtime side effect (face enrollment
 * writes). Those files are ignored by git and are not a leak — the
 * leak the audit cared about is COMMITTING them.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

describe('face-templates directory hygiene', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const dir = path.resolve(repoRoot, 'face-templates');

  test('directory exists with .gitkeep sentinel', () => {
    expect(fs.existsSync(dir)).toBe(true);
    expect(fs.existsSync(path.join(dir, '.gitkeep'))).toBe(true);
  });

  test('only .gitkeep is committed under face-templates/', () => {
    // Query git directly. If git is unavailable (e.g. running outside a
    // checkout), skip gracefully so the test does not produce a false
    // negative on a detached tarball. The guarantee we enforce is
    // "nothing but .gitkeep is tracked" — we can only assert that when
    // there is a git index to inspect.
    let tracked: string[];
    try {
      tracked = execSync('git ls-files face-templates', {
        cwd: repoRoot,
        encoding: 'utf8',
      })
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
    } catch {
      // Not a git checkout — nothing to assert.
      return;
    }

    // Normalize to basenames so the assertion is stable regardless of
    // how git resolves the `face-templates` prefix (relative path,
    // leading `./`, etc.).
    const basenames = tracked.map((entry) => path.basename(entry));
    expect(basenames.sort()).toEqual(['.gitkeep']);
  });

  test('no committed .enc files anywhere under face-templates/', () => {
    let tracked: string[];
    try {
      tracked = execSync('git ls-files face-templates', {
        cwd: repoRoot,
        encoding: 'utf8',
      })
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
    } catch {
      return;
    }
    const leaked = tracked.filter((entry) => entry.endsWith('.enc'));
    expect(leaked).toEqual([]);
  });
});
