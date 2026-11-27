import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectNavPages } from './lib/navigation.mjs';

test('a group nested in a pages array contributes its pages, not its label', () => {
  const nav = {
    tabs: [
      {
        tab: 'Resources',
        groups: [
          {
            group: 'Use Cases',
            pages: [
              'resources/faq',
              { group: 'Creative And Media', pages: ['resources/use-cases/website-maker'] },
            ],
          },
        ],
      },
    ],
  };
  assert.deepEqual(collectNavPages(nav), ['resources/faq', 'resources/use-cases/website-maker']);
});

test('root pages count and external links do not', () => {
  const nav = { groups: [{ group: 'G', root: 'index', pages: ['https://example.com', 'manage/keys'] }] };
  assert.deepEqual(collectNavPages(nav), ['index', 'manage/keys']);
});
