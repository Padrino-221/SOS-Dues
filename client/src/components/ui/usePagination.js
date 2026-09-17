import { useState, useMemo } from 'react';

/**
 * Client-side pagination hook.
 *   const { page, setPage, slice, totalPages, totalItems, perPage } = usePagination(items, perPage = 10);
 * Safe against lists shrinking while on a later page (clamps back automatically).
 */
export default function usePagination(items = [], perPage = 10) {
  const [page, setPage] = useState(1);
  const total = Array.isArray(items) ? items.length : 0;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const safePage = Math.min(page, totalPages);

  const slice = useMemo(
    () => items.slice((safePage - 1) * perPage, safePage * perPage),
    [items, safePage, perPage]
  );

  return { page: safePage, setPage, slice, totalPages, totalItems: total, perPage };
}
