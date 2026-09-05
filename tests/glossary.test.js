const test = require('node:test');
const assert = require('node:assert/strict');
const glossary = require('../web/glossary.js');
const concepts = require('../web/cards.json').concepts;
glossary.configure(concepts);

test('football terms are annotated within sentences without changing the visible copy', () => {
  const text = 'In the red zone, watch the slot receiver and the safeties.';
  const html = glossary.annotate(text);
  assert.match(html, /data-term="red_zone"/);
  assert.match(html, /data-term="slot"/);
  assert.match(html, /data-term="safety"/);
  assert.equal(html.replace(/<[^>]+>/g, ''), text);
});

test('terms match whole words, longest phrases first, and recognize hyphenated forms', () => {
  const html = glossary.annotate('Turnover on downs in the red-zone. A boxcar is not a box.');
  assert.equal((html.match(/data-term=/g) || []).length, 3);
  assert.match(html, /data-term="turnover_on_downs"/);
  assert.match(html, /data-term="red_zone"/);
});

test('untrusted report text is escaped even when it contains a glossary term', () => {
  const html = glossary.annotate('<img src=x onerror="alert(1)"> touchdown');
  assert.ok(!html.includes('<img'));
  assert.match(html, /&lt;img/);
  assert.match(html, /data-term="touchdown"/);
});
