// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState, useEffect, useRef } from 'react';
import { container } from '../../container';
import { ItemSummaryDto } from '../../application/dtos/ItemDtos';

const DEBOUNCE_MS = 300;

export function useGlobalSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ItemSummaryDto[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query.trim()) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const found = await container.searchItems.execute({ query });
        setResults(found);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Search failed');
      } finally {
        setIsSearching(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  return { query, setQuery, results, isSearching, error };
}
