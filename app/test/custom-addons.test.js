'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveAddonName } = require('../src/core/custom-addons');

test('recognizes the dlss5-nr(9) own add-on filename as the RenoDX DLSS5 add-on', () => {
  assert.equal(resolveAddonName('dlss5-nr(9).addon64'), 'renodx-dlss5.addon64');
});
