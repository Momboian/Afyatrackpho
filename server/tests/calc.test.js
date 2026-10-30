// Unit tests for the calculation and validation helpers. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { achievementPct, weekRange, monthRange } from '../util.js';
import { cleanFields, isValidDate } from '../registers.js';

// 14 out of a target of 20 is 70 percent.
test('achievement: target 20, achieved 14 -> 70%', () => assert.equal(achievementPct(14, 20), 70));
// With no target or a zero target the result must be N/A, never 0% or a division error.
test('achievement: missing or zero target -> N/A (never 0% or Infinity)', () => {
  assert.equal(achievementPct(5, null), 'N/A');
  assert.equal(achievementPct(5, undefined), 'N/A');
  assert.equal(achievementPct(5, 0), 'N/A');
});
// 14 October 2026 is a Wednesday, so its week runs from Monday 12 to Sunday 18 October.
test('weeks run Monday to Sunday', () => assert.deepEqual(weekRange('2026-10-14'), { start: '2026-10-12', end: '2026-10-18' }));
// February 2028 has 29 days because 2028 is a leap year.
test('month range handles leap years', () => assert.deepEqual(monthRange('2028-02'), { start: '2028-02-01', end: '2028-02-29' }));
// Impossible dates and other date formats are refused.
test('invalid dates are rejected', () => {
  assert.equal(isValidDate('2026-02-30'), false);
  assert.equal(isValidDate('14/10/2026'), false);
  assert.equal(isValidDate('2026-10-14'), true);
});
// A missing required field returns a readable message.
test('required fields produce clear messages', () => {
  const { errors } = cleanFields({ name: { required: true, label: 'Name' } }, {});
  assert.match(errors.name, /Name is required/);
});
