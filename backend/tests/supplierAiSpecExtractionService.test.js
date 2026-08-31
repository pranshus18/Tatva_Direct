import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSpecificationValuesFromDescription } from '../services/supplierAiSpecExtractionService.js';

function withClearedAiKeys(fn) {
  const keys = ['GEMINI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'CLAUDE_API_KEY'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const key of keys) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    });
}

test('falls back to narrative extraction when AI keys are missing', async () => {
  await withClearedAiKeys(async () => {
    const result = await extractSpecificationValuesFromDescription({
      description:
        'The Jaquar Continental wall hung basin is made of vitreous china in white. Net weight 17.5 kg.',
      productName: 'Jaquar Continental Wall Hung Basin',
      category: 'sanitaryware',
      existingSpecifications: { BRAND: '', COLOR: '', SERIES: '', WEIGHT: '' }
    });

    assert.equal(result.status, 'success');
    assert.equal(result.provider, 'narrative');
    assert.equal(result.specifications.BRAND, 'Jaquar');
    assert.equal(result.specifications.COLOR, 'White');
    assert.equal(result.specifications.SERIES, 'Continental');
    assert.equal(result.specifications.WEIGHT, '17.5 kg');
  });
});

test('returns success with empty specs when the description has no extractable facts', async () => {
  await withClearedAiKeys(async () => {
    const result = await extractSpecificationValuesFromDescription({
      description: 'A wonderful addition to any space. Shop now for quality you can trust.',
      productName: '',
      category: 'sanitaryware',
      existingSpecifications: { BRAND: '', COLOR: '', WEIGHT: '' }
    });

    assert.equal(result.status, 'success');
    assert.equal(result.extractedCount, 0);
  });
});
