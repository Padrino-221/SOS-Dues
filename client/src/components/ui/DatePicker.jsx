import { useState, useRef, useEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import { IconChevronLeft as CaretLeft, IconChevronRight as CaretRight, IconCalendar as CalendarBlank } from '@tabler/icons-react';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Parse a YYYY-MM-DD string into a local-midnight Date; null when unusable. */
function parseDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return null;
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(d, n) {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year, month) {
  return new Date(year, month, 1).getDay();
}

/**
 * Click-to-pick date field.
 *
 * New optional props (both YYYY-MM-DD, ignored when missing/invalid):
 *   min / max — clamp which months the calendar can navigate to and disable
 *               every out-of-range day. Collect.jsx passes max=today.
 *
 * Keyboard: Enter/Space/ArrowDown open the calendar; inside it, arrows move by
 * day/week, Home/End jump to the start/end of the week, PageUp/PageDown change
 * month, Enter/Space pick, Escape closes and returns focus to the field.
 *
 * `required` blocks the enclosing form's submit with an inline error — a
 * `required` hidden input never actually validated.
 */
export default function DatePicker({ value, onChange, required, min, max }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, bottom: 0, left: 0 });
  const [focusDate, setFocusDate] = useState('');
  const [invalid, setInvalid] = useState(false);
  const triggerRef = useRef(null);
  const displayRef = useRef(null);
  const dropRef = useRef(null);
  const titleId = useId();

  // Range guards: bad strings and an impossible range (min > max) are ignored
  // instead of producing a calendar where nothing can ever be selected.
  const rawMin = parseDate(min);
  const rawMax = parseDate(max);
  const rangeValid = !(rawMin && rawMax && rawMin > rawMax);
  const minDate = rangeValid ? rawMin : null;
  const maxDate = rangeValid ? rawMax : null;

  const inRange = (d) => (!minDate || d >= minDate) && (!maxDate || d <= maxDate);

  const clampDate = (d) => {
    let out = d;
    if (minDate && out < minDate) out = minDate;
    if (maxDate && out > maxDate) out = maxDate;
    return inRange(out) ? out : null;
  };

  const valueDate = parseDate(value);
  const today = new Date();
  const todayStr = toStr(today);

  const [viewDate, setViewDate] = useState(() => {
    const base = (valueDate && clampDate(valueDate)) || clampDate(new Date()) || valueDate || new Date();
    return { year: base.getFullYear(), month: base.getMonth() };
  });

  const updatePosition = () => {
    if (triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      const vw = window.innerWidth || document.documentElement.clientWidth;
      // Rough calendar height (incl. shadow) so it flips up when too low.
      const CAL_H = 420;
      const spaceBelow = window.innerHeight - r.bottom - 8;
      const spaceAbove = r.top - 8;
      const up = spaceBelow < CAL_H && spaceAbove > spaceBelow;
      setPos({
        top: r.bottom + 4,
        bottom: window.innerHeight - r.top + 4,
        left: Math.max(8, Math.min(r.left, vw - 306)),
        up,
      });
    }
  };

  useEffect(() => {
    const handler = (e) => {
      if (
        triggerRef.current &&
        !triggerRef.current.contains(e.target) &&
        dropRef.current &&
        !dropRef.current.contains(e.target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (open) {
      const scrollEl = triggerRef.current?.closest('.modal-card, .main-scroll');
      const onScroll = () => {
        if (open) updatePosition();
      };
      scrollEl?.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', updatePosition);
      return () => {
        scrollEl?.removeEventListener('scroll', onScroll);
        window.removeEventListener('resize', updatePosition);
      };
    }
    return undefined;
  }, [open]);

  // Keyboard highlight follows focusDate; move real DOM focus into the grid on
  // open and after every arrow jump (the calendar lives in a portal).
  useEffect(() => {
    if (!open || !focusDate) return undefined;
    const frame = requestAnimationFrame(() => {
      const el = dropRef.current && dropRef.current.querySelector(`[data-date="${focusDate}"]`);
      if (el && document.activeElement !== el) el.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open, focusDate]);

  // `required` on a hidden input never validates — guard the submit here.
  useEffect(() => {
    if (!required) return undefined;
    const form = triggerRef.current && triggerRef.current.closest('form');
    if (!form) return undefined;
    const onSubmit = (e) => {
      if (parseDate(value)) return;
      e.preventDefault();
      e.stopPropagation();
      setInvalid(true);
      if (displayRef.current) displayRef.current.focus();
    };
    form.addEventListener('submit', onSubmit);
    return () => form.removeEventListener('submit', onSubmit);
  }, [required, value]);

  useEffect(() => {
    if (parseDate(value)) setInvalid(false);
  }, [value]);

  const displayValue = valueDate
    ? valueDate.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : '';

  const daysInMonth = getDaysInMonth(viewDate.year, viewDate.month);
  const firstDay = getFirstDayOfMonth(viewDate.year, viewDate.month);

  const viewNum = viewDate.year * 12 + viewDate.month;
  const atMinMonth = Boolean(minDate) && viewNum <= minDate.getFullYear() * 12 + minDate.getMonth();
  const atMaxMonth = Boolean(maxDate) && viewNum >= maxDate.getFullYear() * 12 + maxDate.getMonth();

  const prevMonth = () => {
    if (atMinMonth) return;
    setViewDate((v) =>
      v.month === 0 ? { year: v.year - 1, month: 11 } : { ...v, month: v.month - 1 }
    );
  };

  const nextMonth = () => {
    if (atMaxMonth) return;
    setViewDate((v) =>
      v.month === 11 ? { year: v.year + 1, month: 0 } : { ...v, month: v.month + 1 }
    );
  };

  const closeCalendar = () => {
    setOpen(false);
    if (displayRef.current) displayRef.current.focus();
  };

  const selectDate = (d) => {
    if (!inRange(d)) return;
    onChange(toStr(d));
    setInvalid(false);
    closeCalendar();
  };

  const openCalendar = () => {
    updatePosition();
    const preferred = valueDate && inRange(valueDate) ? valueDate : null;
    const base = preferred || clampDate(new Date()) || valueDate || new Date();
    setViewDate({ year: base.getFullYear(), month: base.getMonth() });
    setFocusDate(toStr(base));
    setOpen(true);
  };

  // Move keyboard focus to `target`, keeping its month in view. Out-of-range
  // targets walk back towards the allowed window (never more than a month).
  const moveTo = (target) => {
    let next = target;
    let guard = 0;
    while (!inRange(next) && guard++ < 800) {
      next = addDays(next, minDate && next < minDate ? 1 : -1);
    }
    if (!inRange(next)) return;
    setFocusDate(toStr(next));
    setViewDate({ year: next.getFullYear(), month: next.getMonth() });
  };

  const onGridKeyDown = (e) => {
    const current = parseDate(focusDate);
    if (!current) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeCalendar();
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      // Only day cells pick a date — the nav/footer buttons must keep their
      // native Enter/Space activation.
      if (!e.target || !e.target.getAttribute || !e.target.getAttribute('data-date')) return;
      e.preventDefault();
      e.stopPropagation();
      selectDate(current);
      return;
    }
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        moveTo(addDays(current, -1));
        break;
      case 'ArrowRight':
        e.preventDefault();
        moveTo(addDays(current, 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        moveTo(addDays(current, -7));
        break;
      case 'ArrowDown':
        e.preventDefault();
        moveTo(addDays(current, 7));
        break;
      case 'Home':
        e.preventDefault();
        moveTo(addDays(current, -current.getDay()));
        break;
      case 'End':
        e.preventDefault();
        moveTo(addDays(current, 6 - current.getDay()));
        break;
      case 'PageUp':
        e.preventDefault();
        moveTo(new Date(current.getFullYear(), current.getMonth() - 1, 1));
        break;
      case 'PageDown':
        e.preventDefault();
        moveTo(new Date(current.getFullYear(), current.getMonth() + 1, 1));
        break;
      default:
        break;
    }
  };

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <>
      <div className="cs-date" ref={triggerRef}>
        <div
          className="cs-date-display"
          ref={displayRef}
          role="button"
          tabIndex={0}
          onClick={openCalendar}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
              e.preventDefault();
              openCalendar();
            } else if (e.key === 'Escape' && open) {
              e.preventDefault();
              e.stopPropagation();
              closeCalendar();
            }
          }}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-required={required || undefined}
          aria-invalid={invalid || undefined}
        >
          <span className={value ? 'cs-selected' : 'cs-placeholder'}>
            {displayValue || 'Select date'}
          </span>
          <CalendarBlank size={16} className="cs-date-icon" />
        </div>
      </div>
      {invalid && (
        <div className="field-error" role="alert">
          This field is required
        </div>
      )}
      {open &&
        createPortal(
          <div
            className="cs-calendar"
            ref={dropRef}
            role="dialog"
            aria-label="Choose a date"
            onKeyDown={onGridKeyDown}
            style={{
              position: 'fixed',
              top: pos.up ? undefined : pos.top,
              bottom: pos.up ? pos.bottom : undefined,
              left: pos.left,
            }}
          >
            <div className="cs-cal-header">
              <button
                type="button"
                className="cs-cal-nav"
                onClick={prevMonth}
                disabled={atMinMonth}
                aria-label="Previous month"
              >
                <CaretLeft size={16} />
              </button>
              <span className="cs-cal-title" id={titleId} aria-live="polite">
                {MONTHS[viewDate.month]} {viewDate.year}
              </span>
              <button
                type="button"
                className="cs-cal-nav"
                onClick={nextMonth}
                disabled={atMaxMonth}
                aria-label="Next month"
              >
                <CaretRight size={16} />
              </button>
            </div>
            <div className="cs-cal-days" aria-hidden="true">
              {DAYS.map((d) => (
                <div key={d} className="cs-cal-dayname">
                  {d}
                </div>
              ))}
            </div>
            <div className="cs-cal-grid">
              {cells.map((day, i) => {
                if (day === null) return <div key={`e${i}`} className="cs-cal-empty" />;
                const dateStr = `${viewDate.year}-${String(viewDate.month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const dateObj = new Date(viewDate.year, viewDate.month, day);
                const isSelected = dateStr === value;
                const isToday = dateStr === todayStr;
                const disabled = !inRange(dateObj);
                return (
                  <div
                    key={day}
                    data-date={dateStr}
                    role="button"
                    tabIndex={dateStr === focusDate ? 0 : -1}
                    aria-label={dateObj.toLocaleDateString('en-GB', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })}
                    aria-current={isToday ? 'date' : undefined}
                    aria-disabled={disabled || undefined}
                    className={`cs-cal-day ${isSelected ? 'cs-cal-selected' : ''} ${isToday ? 'cs-cal-today' : ''} ${disabled ? 'cs-cal-disabled' : ''}`}
                    onClick={() => !disabled && selectDate(dateObj)}
                  >
                    {day}
                  </div>
                );
              })}
            </div>
            <div className="cs-cal-footer">
              <button
                type="button"
                className="cs-cal-today-btn"
                disabled={!inRange(today)}
                onClick={() => selectDate(new Date(today.getFullYear(), today.getMonth(), today.getDate()))}
              >
                Today
              </button>
              <button
                type="button"
                className="cs-cal-clear-btn"
                onClick={() => {
                  onChange('');
                  setInvalid(false);
                  closeCalendar();
                }}
              >
                Clear
              </button>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
