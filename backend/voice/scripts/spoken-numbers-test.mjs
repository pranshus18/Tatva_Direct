import { parseQuantity, parseSelectionIndex, isExplicitCancel } from '../lib/spokenNumbers.js';

const qtyCases = [
  ['2', 2],
  ['two', 2],
  ['to', 2],
  ['too', 2],
  ['2 nos', 2],
  ['two nos', 2],
  ['not two', 2],
  ['two in nos', 2],
  ['number two', 2],
  ['number 5', 5],
  ['qty 3', 3],
  ['two pieces', 2],
  ['I want 3', 3],
  ['no', null]
];

const cancelCases = [
  ['no', 'await_add_quantity', false],
  ['no', 'await_select_supplier', false],
  ['cancel', 'await_add_quantity', true],
  ['2', 'await_add_quantity', false],
  ['two', 'await_select_supplier', false]
];

let failed = 0;
for (const [input, expected] of qtyCases) {
  const got = parseQuantity(input);
  if (got !== expected) {
    console.error(`parseQuantity(${JSON.stringify(input)}) = ${got}, expected ${expected}`);
    failed += 1;
  }
}
for (const [input, pending, expected] of cancelCases) {
  const got = isExplicitCancel(input, { pendingType: pending });
  if (got !== expected) {
    console.error(`isExplicitCancel(${JSON.stringify(input)}, ${pending}) = ${got}, expected ${expected}`);
    failed += 1;
  }
}
if (parseSelectionIndex('two', 3) !== 1) {
  console.error('parseSelectionIndex(two, 3) should be 1');
  failed += 1;
}
if (failed) {
  process.exit(1);
}
console.log('spoken-numbers-test: ok');
