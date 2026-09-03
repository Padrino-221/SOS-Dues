import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { CaretLeft, CaretRight, CalendarBlank } from '@phosphor-icons/react';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year, month) {
  return new Date(year, month, 1).getDay();
}

export default function DatePicker({ value, onChange, required }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [viewDate, setViewDate] = useState(() => {
    if (value) {
      const d = new Date(value + 'T00:00:00');
      return { year: d.getFullYear(), month: d.getMonth() };
    }
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const triggerRef = useRef(null);
  const dropRef = useRef(null);

  const updatePosition = () => {
    if (triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left });
    }
  };

  useEffect(() => {
    const handler = (e) => {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target) &&
        dropRef.current && !dropRef.current.contains(e.target)
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
      const onScroll = () => { if (open) updatePosition(); };
      scrollEl?.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', updatePosition);
      return () => {
        scrollEl?.removeEventListener('scroll', onScroll);
        window.removeEventListener('resize', updatePosition);
      };
    }
  }, [open]);

  const displayValue = value
    ? new Date(value + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : '';

  const daysInMonth = getDaysInMonth(viewDate.year, viewDate.month);
  const firstDay = getFirstDayOfMonth(viewDate.year, viewDate.month);
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const prevMonth = () => {
    setViewDate((v) => v.month === 0 ? { year: v.year - 1, month: 11 } : { ...v, month: v.month - 1 });
  };

  const nextMonth = () => {
    setViewDate((v) => v.month === 11 ? { year: v.year + 1, month: 0 } : { ...v, month: v.month + 1 });
  };

  const selectDay = (day) => {
    const mm = String(viewDate.month + 1).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    onChange(`${viewDate.year}-${mm}-${dd}`);
    setOpen(false);
  };

  const handleOpen = () => {
    updatePosition();
    setOpen(true);
  };

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <>
      <div className="cs-date" ref={triggerRef}>
        <div className="cs-date-display" onClick={handleOpen}>
          <span className={value ? 'cs-selected' : 'cs-placeholder'}>
            {displayValue || 'Select date'}
          </span>
          <CalendarBlank size={16} className="cs-date-icon" />
        </div>
      </div>
      <input type="hidden" value={value || ''} required={required} />
      {open && createPortal(
        <div className="cs-calendar" ref={dropRef} style={{ position: 'fixed', top: pos.top, left: pos.left }}>
          <div className="cs-cal-header">
            <button type="button" className="cs-cal-nav" onClick={prevMonth}><CaretLeft size={16} /></button>
            <span className="cs-cal-title">{MONTHS[viewDate.month]} {viewDate.year}</span>
            <button type="button" className="cs-cal-nav" onClick={nextMonth}><CaretRight size={16} /></button>
          </div>
          <div className="cs-cal-days">
            {DAYS.map((d) => <div key={d} className="cs-cal-dayname">{d}</div>)}
          </div>
          <div className="cs-cal-grid">
            {cells.map((day, i) => {
              if (day === null) return <div key={`e${i}`} className="cs-cal-empty" />;
              const dateStr = `${viewDate.year}-${String(viewDate.month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const isSelected = dateStr === value;
              const isToday = dateStr === todayStr;
              return (
                <div
                  key={day}
                  className={`cs-cal-day ${isSelected ? 'cs-cal-selected' : ''} ${isToday ? 'cs-cal-today' : ''}`}
                  onClick={() => selectDay(day)}
                >
                  {day}
                </div>
              );
            })}
          </div>
          <div className="cs-cal-footer">
            <button type="button" className="cs-cal-today-btn" onClick={() => {
              const mm = String(today.getMonth() + 1).padStart(2, '0');
              const dd = String(today.getDate()).padStart(2, '0');
              onChange(`${today.getFullYear()}-${mm}-${dd}`);
              setViewDate({ year: today.getFullYear(), month: today.getMonth() });
              setOpen(false);
            }}>Today</button>
            <button type="button" className="cs-cal-clear-btn" onClick={() => { onChange(''); setOpen(false); }}>Clear</button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
