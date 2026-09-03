import { CaretLeft, CaretRight } from '@phosphor-icons/react';

/**
 * Pagination component
 * Props:
 *  - page: current page (1-indexed)
 *  - totalPages: total number of pages
 *  - onPageChange: (newPage) => void
 *  - totalItems: total item count (optional, for display)
 *  - pageSize: items per page (optional, for display)
 */
export default function Pagination({ page, totalPages, onPageChange, totalItems, pageSize }) {
  if (totalPages <= 1) return null;

  const getVisiblePages = () => {
    const pages = [];
    const maxVisible = 7;

    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (page > 3) pages.push('...');

      const start = Math.max(2, page - 1);
      const end = Math.min(totalPages - 1, page + 1);
      for (let i = start; i <= end; i++) pages.push(i);

      if (page < totalPages - 2) pages.push('...');
      pages.push(totalPages);
    }
    return pages;
  };

  const pages = getVisiblePages();
  const startItem = (page - 1) * (pageSize || 10) + 1;
  const endItem = Math.min(page * (pageSize || 10), totalItems || 0);

  return (
    <div className="flex between align-center" style={{ padding: '14px 0' }}>
      <span className="muted text-sm">
        {totalItems != null && (
          <>Showing {startItem}–{endItem} of {totalItems}</>
        )}
      </span>
      <div className="flex align-center gap-sm">
        <button
          className="btn btn-outline btn-sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <CaretLeft size={14} />
        </button>
        {pages.map((p, i) =>
          p === '...' ? (
            <span key={`ellipsis-${i}`} className="muted text-sm" style={{ padding: '0 4px' }}>…</span>
          ) : (
            <button
              key={p}
              className={`btn btn-sm ${p === page ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => onPageChange(p)}
              style={{ minWidth: 36 }}
            >
              {p}
            </button>
          )
        )}
        <button
          className="btn btn-outline btn-sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          <CaretRight size={14} />
        </button>
      </div>
    </div>
  );
}
