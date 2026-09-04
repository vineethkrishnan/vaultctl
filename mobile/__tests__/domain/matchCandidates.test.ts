// SPDX-License-Identifier: AGPL-3.0-or-later

import { matchCandidates } from '../../src/domain/autofill/matchCandidates';
import { webTarget, appTarget } from '../../src/domain/autofill/AutofillTarget';
import type { AutofillCandidate } from '../../src/domain/autofill/AutofillCandidate';

function candidate(
  overrides: Partial<AutofillCandidate> & { itemId: string },
): AutofillCandidate {
  return {
    vaultId: 'vault-1',
    name: overrides.itemId,
    username: 'user@example.com',
    uris: [],
    ...overrides,
  };
}

describe('matchCandidates - web targets', () => {
  it('offers an item saved on the same host', () => {
    const github = candidate({
      itemId: 'github',
      uris: ['https://github.com/login'],
    });
    const matches = matchCandidates(webTarget('https://github.com/session'), [
      github,
    ]);
    expect(matches.map((m) => m.candidate.itemId)).toEqual(['github']);
    expect(matches[0]!.strength).toBe('exact');
  });

  it('treats apex and www as the same site', () => {
    const item = candidate({ itemId: 'shop', uris: ['https://www.shop.com/'] });
    expect(matchCandidates(webTarget('https://shop.com/'), [item])).toHaveLength(
      1,
    );
  });

  it('does not offer a sibling subdomain by default', () => {
    const item = candidate({
      itemId: 'mail',
      uris: ['https://mail.google.com/'],
    });
    expect(
      matchCandidates(webTarget('https://accounts.google.com/'), [item]),
    ).toHaveLength(0);
  });

  it('offers a sibling subdomain only when relaxed matching is on', () => {
    const item = candidate({
      itemId: 'mail',
      uris: ['https://mail.google.com/'],
    });
    const matches = matchCandidates(
      webTarget('https://accounts.google.com/'),
      [item],
      { allowRelatedDomains: true },
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]!.strength).toBe('domain');
  });

  it('never leaks across tenants of a multi-tenant host', () => {
    const item = candidate({ itemId: 'mine', uris: ['https://mine.github.io/'] });
    expect(
      matchCandidates(webTarget('https://theirs.github.io/'), [item], {
        allowRelatedDomains: true,
      }),
    ).toHaveLength(0);
  });

  it('ignores a non-http URI stored on the item', () => {
    const item = candidate({
      itemId: 'weird',
      uris: ['javascript:alert(1)', 'file:///etc/passwd'],
    });
    expect(matchCandidates(webTarget('https://github.com/'), [item])).toHaveLength(
      0,
    );
  });

  it('does not confuse a different port with the same site', () => {
    const item = candidate({ itemId: 'dev', uris: ['https://localhost:3000/'] });
    expect(
      matchCandidates(webTarget('https://localhost:8080/'), [item]),
    ).toHaveLength(0);
  });
});

describe('matchCandidates - app targets', () => {
  it('offers an item captured against that package', () => {
    const item = candidate({
      itemId: 'paypal',
      uris: ['https://paypal.com/'],
      appIdentifiers: ['com.paypal.android.p2pmobile'],
    });
    const matches = matchCandidates(
      appTarget('android', 'com.paypal.android.p2pmobile'),
      [item],
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]!.strength).toBe('app');
  });

  it('refuses a package name that merely contains the brand', () => {
    const item = candidate({
      itemId: 'paypal',
      uris: ['https://paypal.com/'],
      appIdentifiers: ['com.paypal.android.p2pmobile'],
    });
    expect(
      matchCandidates(appTarget('android', 'com.evil.paypal'), [item]),
    ).toHaveLength(0);
  });

  it('never matches an app target against a saved URI', () => {
    const item = candidate({ itemId: 'paypal', uris: ['https://paypal.com/'] });
    expect(
      matchCandidates(appTarget('android', 'com.paypal.android.p2pmobile'), [
        item,
      ]),
    ).toHaveLength(0);
  });
});

describe('matchCandidates - ordering', () => {
  it('puts exact host matches ahead of relaxed domain matches', () => {
    const exact = candidate({
      itemId: 'exact',
      name: 'Zed',
      uris: ['https://accounts.google.com/'],
    });
    const related = candidate({
      itemId: 'related',
      name: 'Alpha',
      uris: ['https://mail.google.com/'],
    });
    const matches = matchCandidates(
      webTarget('https://accounts.google.com/'),
      [related, exact],
      { allowRelatedDomains: true },
    );
    expect(matches.map((m) => m.candidate.itemId)).toEqual(['exact', 'related']);
  });
});
