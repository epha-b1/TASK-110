import request from 'supertest';
import app from '../src/app';

describe('Slice 1 — Health API', () => {
  test('GET /health returns 200 with status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.timestamp).toBeDefined();
  });

  test('GET /nonexistent returns 404', async () => {
    const res = await request(app).get('/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  test('X-Trace-Id header is present on every response', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-trace-id']).toBeDefined();
    expect(res.headers['x-trace-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  test('404 response also includes X-Trace-Id', async () => {
    const res = await request(app).get('/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.headers['x-trace-id']).toBeDefined();
  });

  test('error response includes traceId in body', async () => {
    const res = await request(app).get('/does-not-exist');
    expect(res.body.traceId).toBeDefined();
    expect(res.body.statusCode).toBe(404);
  });

  // ─── OpenAPI / Swagger UI surface ────────────────────────────────
  // The interactive API explorer is mounted on TWO paths so reviewers
  // can find it at the conventional `/docs` location AND at the
  // historical `/api/docs` path. Both must serve the swagger UI HTML
  // shell, and `/docs/openapi.json` must serve the raw spec for
  // tooling that consumes the OpenAPI document directly.
  test('GET /docs serves swagger UI HTML (canonical short path)', async () => {
    const res = await request(app).get('/docs/').redirects(1);
    expect(res.status).toBe(200);
    // swagger-ui-express ships an HTML shell that references swagger
    // assets. The exact body changes between versions, so we assert
    // on stable, version-agnostic markers.
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toMatch(/swagger/i);
  });

  test('GET /api/docs still serves swagger UI HTML (legacy path)', async () => {
    const res = await request(app).get('/api/docs/').redirects(1);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toMatch(/swagger/i);
  });

  test('GET /docs/openapi.json returns the raw OpenAPI 3 spec', async () => {
    const res = await request(app).get('/docs/openapi.json');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    // OpenAPI 3 documents declare openapi version, info, and paths.
    expect(res.body.openapi).toMatch(/^3\./);
    expect(res.body.info?.title).toBeDefined();
    expect(typeof res.body.paths).toBe('object');
    // Spot-check that a known path is present in the spec.
    expect(res.body.paths['/health']).toBeDefined();
  });

  test('GET /api/docs/openapi.json returns the same OpenAPI 3 spec (legacy alias)', async () => {
    // The spec is mounted on two paths so clients using either the
    // short canonical `/docs` or the legacy `/api/docs` get identical
    // documents. Assert byte-equivalence of the core structure.
    const canonical = await request(app).get('/docs/openapi.json');
    const legacy = await request(app).get('/api/docs/openapi.json');
    expect(legacy.status).toBe(200);
    expect(legacy.headers['content-type']).toMatch(/application\/json/);
    expect(legacy.body.openapi).toBe(canonical.body.openapi);
    expect(legacy.body.info?.title).toBe(canonical.body.info?.title);
    expect(Object.keys(legacy.body.paths).sort())
      .toEqual(Object.keys(canonical.body.paths).sort());
    // Representative path regression check — if /health disappears
    // from the spec the contract breaks for every downstream client.
    expect(legacy.body.paths['/health']).toBeDefined();
    expect(legacy.body.paths['/reports/revenue-mix']).toBeDefined();
  });
});
