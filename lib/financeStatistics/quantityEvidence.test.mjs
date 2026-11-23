import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './testLoader.mjs';

const { readQuantityEvidence } = loadModule('quantityEvidence.ts');

test('Chinese quantities retain separate evidence beside an Arabic price', () => {
  assert.deepEqual(readQuantityEvidence('288一束花', '束'), [
    { value: 1, raw: '一', index: 3, end: 4, notation: 'chinese' },
  ]);
  assert.deepEqual(readQuantityEvidence('288一束花', null).map(item => [item.value, item.notation]), [
    [288, 'arabic'], [1, 'chinese'],
  ]);
});

test('precise Chinese integers and common formal variants are recognized', () => {
  for (const [raw, value] of [
    ['零', 0], ['〇', 0], ['一', 1], ['两', 2], ['兩', 2], ['十', 10], ['一十', 10],
    ['十一', 11], ['二十', 20], ['二十一', 21], ['一百零一', 101], ['两百', 200],
    ['千', 1000], ['一千零二十', 1020], ['一千零十二', 1012], ['万', 10000],
    ['一万零一', 10001], ['十万', 100000], ['两万三千四百五十六', 23456],
    ['九千九百九十九万九千九百九十九', 99999999], ['壹佰零壹', 101],
  ]) {
    assert.deepEqual(readQuantityEvidence(`${raw}束`, '束').map(item => item.value), [value], raw);
  }
});

test('whole numeric expressions are consumed, never a suffix of a larger number', () => {
  assert.deepEqual(readQuantityEvidence('二十一束', '束').map(item => item.value), [21]);
  assert.deepEqual(readQuantityEvidence('121束', '束').map(item => item.value), [121]);
  for (const raw of ['两三', '一两', '三四', '十几', '十多', '三点五', '三分之一', '一百二', '一千一', '十十', '一亿']) {
    assert.deepEqual(readQuantityEvidence(`${raw}束`, '束'), [], raw);
    assert.deepEqual(readQuantityEvidence(`${raw}束`, null), [], raw);
  }
  assert.deepEqual(readQuantityEvidence('两束半', '束'), []);
});

test('Arabic quantities require complete nonnegative safe integer evidence', () => {
  for (const [raw, value] of [['0', 0], ['2', 2], ['+2', 2], ['2.0', 2], ['1,200', 1200], ['9007199254740991', Number.MAX_SAFE_INTEGER]]) {
    assert.deepEqual(readQuantityEvidence(`${raw}束`, '束').map(item => item.value), [value], raw);
  }
  for (const raw of ['-2', '−2', '1.5', '.5', '1e3', '1,20', '1.2.3', '9007199254740992']) {
    assert.deepEqual(readQuantityEvidence(`${raw}束`, '束'), [], raw);
  }
  for (const text of ['3十束', '二十3束', '-一束', '负一束']) {
    assert.deepEqual(readQuantityEvidence(text, '束'), [], text);
    assert.deepEqual(readQuantityEvidence(text, null), [], text);
  }
});

test('unit matching accepts spacing and fullwidth notation while retaining original offsets', () => {
  const text = '💐２８８元　两 束，３６８元 十束';
  const evidence = readQuantityEvidence(text, '束');
  assert.deepEqual(evidence.map(item => item.value), [2, 10]);
  for (const item of evidence) assert.equal(text.slice(item.index, item.end), item.raw);
  const arabic = readQuantityEvidence('２束', '束')[0];
  assert.deepEqual(arabic, { value: 2, raw: '２', index: 0, end: 1, notation: 'arabic' });
  assert.deepEqual(readQuantityEvidence('288元两束', '盒'), []);
  assert.deepEqual(readQuantityEvidence('2kg', 'k'), []);
  assert.deepEqual(readQuantityEvidence('2kg', 'kg').map(item => item.value), [2]);
});

test('written line amounts remain separate from Chinese quantity evidence', () => {
  assert.deepEqual(readQuantityEvidence('288两束576元', '束').map(item => item.value), [2]);
  assert.deepEqual(readQuantityEvidence('288两束576元', null).map(item => item.value), [288, 2, 576]);
  assert.deepEqual(readQuantityEvidence('168两束，每束提成15元', '束').map(item => item.value), [2]);
});
