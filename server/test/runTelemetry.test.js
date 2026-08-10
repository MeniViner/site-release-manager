import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeEvents } from '../src/services/runTelemetry.js';

test('summarizeEvents groups stage start/success and calculates duration', () => {
  const result = summarizeEvents([
    { eventId: '1', stage: 'FORM_DIGEST', stageLabel: 'Digest', status: 'started', source: 'deployer', at: new Date('2026-01-01T00:00:00.000Z') },
    { eventId: '2', stage: 'FORM_DIGEST', stageLabel: 'Digest', status: 'success', source: 'deployer', message: 'ok', at: new Date('2026-01-01T00:00:01.250Z') },
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].status, 'success');
  assert.equal(result[0].durationMs, 1250);
  assert.equal(result[0].message, 'ok');
});

test('summarizeEvents keeps failed stage as failed', () => {
  const result = summarizeEvents([
    { stage: 'RELEASE_FILES', status: 'started', at: new Date('2026-01-01T00:00:00Z') },
    { stage: 'RELEASE_FILES', status: 'failed', message: 'HTTP 403', at: new Date('2026-01-01T00:00:02Z') },
  ]);
  assert.equal(result[0].status, 'failed');
  assert.equal(result[0].message, 'HTTP 403');
});
