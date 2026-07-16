// SPDX-License-Identifier: AGPL-3.0-or-later

// Filter-as-you-type for the login picker. The query is whatever the user has
// typed into the username/email field; a credential stays visible when the
// query is a case-insensitive substring of its username or its item name, so
// typing part of an address (or a name) narrows a long list to the one login
// the user wants. An empty query shows everything.

export interface CredentialLike {
  username?: string;
  name?: string;
}

export function credentialMatchesQuery(
  credential: CredentialLike,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const username = (credential.username ?? "").toLowerCase();
  const name = (credential.name ?? "").toLowerCase();
  return username.includes(needle) || name.includes(needle);
}

export function filterCredentials<T extends CredentialLike>(
  credentials: T[],
  query: string,
): T[] {
  return credentials.filter((credential) =>
    credentialMatchesQuery(credential, query),
  );
}
