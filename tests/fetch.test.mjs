import test from 'node:test';
import assert from 'node:assert/strict';
import { filterTLE, GROUPS, DERIVED } from '../scripts/fetch-tle.mjs';

const tri = (name, id) => [name, `1 ${id}U 20001A   26324.50000000  .00001000  00000-0  10000-3 0  9990`, `2 ${id}  53.0000   0.0000 0001000  90.0000   0.0000 15.06000000100000`];

test('Starlink est extrait du groupe « active »', () => {
  const txt = [tri('STARLINK-1007', '44713'), tri('ISS (ZARYA)', '25544'), tri('STARLINK-31000', '60001'), tri('ONEWEB-0012', '44057')].flat().join('\r\n') + '\r\n';
  const out = filterTLE(txt, DERIVED.starlink.re);
  assert.equal((out.match(/^1 /gm) || []).length, 2);
  assert.match(out, /STARLINK-1007/); assert.match(out, /STARLINK-31000/); assert.doesNotMatch(out, /ISS|ONEWEB/);
  assert.equal(filterTLE(txt, /^NOPE/), '');
});

test('Starlink n\'est jamais téléchargé directement, et le groupe source l\'est', () => {
  assert.ok(!GROUPS.includes('starlink'));
  assert.ok(GROUPS.includes(DERIVED.starlink.from));
});
