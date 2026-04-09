/**
 * Per-suite setup + teardown for unit tests.
 *
 * Jest spins up a worker per test file. When the file finishes, the worker
 * must exit cleanly — any dangling handle (winston Console stream, async
 * hooks store, intervals, etc.) produces the noisy "worker process has
 * failed to exit gracefully" warning.
 *
 * This file is registered via `setupFilesAfterEnv` in `jest.config.js`
 * for the unit project and runs once per test file. It does two things:
 *
 *   1) Raises the process EventEmitter max-listener cap. Tests that call
 *      `jest.resetModules()` repeatedly cause winston to re-register
 *      process exit listeners on each module reload, eventually crossing
 *      the 10-listener default and emitting a MaxListenersExceededWarning.
 *      The warning is cosmetic but pollutes CI output.
 *
 *   2) Closes the singleton winston logger after all tests in the file
 *      finish so the stdout transport stream can be released and the
 *      worker exits cleanly.
 *
 * If the worker-exit warning ever recurs, run with `--detectOpenHandles`
 * to get a stack trace — see `docs/final-acceptance-hardening.md`.
 */
import { logger } from '../src/utils/logger';

// Module-scope: applies once when jest loads this setup file per test file.
process.setMaxListeners(64);

afterAll(() => {
  // Close winston transports — the default Console transport holds a
  // writable stream that, under parallel worker shutdown, can keep the
  // worker alive long enough for jest to force-exit it.
  try {
    logger.close();
  } catch {
    /* already closed — safe to ignore */
  }
});
