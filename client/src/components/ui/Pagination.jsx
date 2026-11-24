import { useEffect } from 'react';
import { IconChevronLeft as CaretLeft, IconChevronRight as CaretRight } from '@tabler/icons-react';

/**
 * Pagination component
 * Props:
 *  - page: current page (1-indexed)
 *  - totalPages: total number of pages
 *  - onPageChange: (newPage) => void
 *  - totalItems: total item count (optional, for display)
 *  - pageSize: items per page (optional, for display)
 *
 * If `page` points past the end (the list shrank after a delete/filter), the
 * corrected page is emitted through onPageChange so nobody is stranded on an
 * empty page, and the visible state is clamped in the meantime.
 */
export default function Pagination({ page, totalPages, onPageChange, totalItems, pageSize }) {
  const lastPage = Math.max(1, totalPages || 1);
  const activePage = Math.min(Math.max(1, page || 1), lastPage);

  useEffect(() => {
    if (!onPageChange || activePage === page) return;
    onPageChange(activePage);
  }, [page, activePage, onPageChange]);

  if (totalPages <= 1) return null;

  const getVisiblePages = () => {
    const pages = [];
    const maxVisible = 7;

    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (activePage > 3) pages.push('...');

      const start = Math.max(2, activePage - 1);
      const end = Math.min(totalPages - 1, activePage + 1);
      for (let i = start; i <= end; i++) pages.push(i);

      if (activePage < totalPages - 2) pages.push('...');
      pages.push(totalPages);
    }
    return pages;
  };

  const pages = getVisiblePages();
  const startItem = (activePage - 1) * (pageSize || 10) + 1;
  const endItem = Math.min(activePage * (pageSize || 10), totalItems || 0);

  return (
    <div className="flex between align-center" style={{ padding: '14px 0' }}>
      <span className="muted text-sm">
        {totalItems != null && (
          <>
            Showing {startItem}–{endItem} of {totalItems}
          </>
        )}
      </span>
      <div className="flex align-center gap-sm">
        <button
          className="btn btn-outline btn-sm"
          disabled={activePage <= 1}
          onClick={() => onPageChange(activePage - 1)}
          aria-label="Previous page"
        >
          <CaretLeft size={14} />
        </button>
        {pages.map((p, i) =>
          p === '...' ? (
            <span key={`ellipsis-${i}`} className="muted text-sm" style={{ padding: '0 4px' }}>
              …
            </span>
          ) : (
            <button
              key={p}
              className={`btn btn-sm ${p === activePage ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => onPageChange(p)}
              style={{ minWidth: 44 }}
              aria-label={`Page ${p}`}
              aria-current={p === activePage ? 'page' : undefined}
            >
              {p}
            </button>
          )
        )}
        <button
          className="btn btn-outline btn-sm"
          disabled={activePage >= totalPages}
          onClick={() => onPageChange(activePage + 1)}
          aria-label="Next page"
        >
          <CaretRight size={14} />
        </button>
      </div>
    </div>
  );
}
