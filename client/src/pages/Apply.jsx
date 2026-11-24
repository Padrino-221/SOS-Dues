import { useEffect, useState } from 'react';
import api from '../api/client';
import { IconSend as PaperPlaneTilt, IconCircleCheck as CheckCircle, IconCircleCheckFilled as CircleCheckFilled, IconAlertTriangle as Warning } from '@tabler/icons-react';
import Select from '../components/ui/Select';

const GENDER_OPTIONS = [
  { value: 'Female', label: 'Female' },
  { value: 'Male', label: 'Male' },
  { value: 'Other', label: 'Other' },
];

const EMPTY_FORM = {
  full_name: '',
  student_no: '',
  phone: '',
  email: '',
  programme: '',
  gender: '',
  hometown: '',
};

// Student reference numbers usually look like UA2309264: "UA" + 7 digits.
// Kept for admin-side entry (Freshers register / verify on retyped numbers).
// The public apply form accepts any reference number the applicant types
// (SMK/2021/045 etc.) but checks its SHAPE — a mirror of server
// src/utils/studentNo.js: normalize (trim, drop inner spaces, uppercase,
// strip stray trailing punctuation) then letters-and-numbers only, so phone
// digits and stray keystrokes never reach the queue.
export const STUDENT_NO_RE = /^UA\d{7}$/i;
export const normalizeStudentNo = (v) =>
  String(v ?? '')
    .trim()
    .replace(/\s+/g, '')
    .toUpperCase()
    .replace(/[.,;]+$/, '');
const REFERENCE_SHAPE_RE = /^[A-Z0-9./-]+$/;

// Character rules mirrored from server/src/utils/inputRules.js — the server
// re-checks everything; these just fail fast with a clear message.
// Names: letters + spaces/hyphens/apostrophes/periods only (no digits, no
// emoji). Phone: digits only, spaces allowed ("0244 000 000").
export const NAME_RE = /^[\p{L}][\p{L}\s'.-]*$/u;
export const PHONE_RE = /^[0-9\s]+$/;

// Draft persistence: freshers fill this on phones where the browser can
// evict the tab at any moment (patchy network, low-end devices, 1500+
// students on one NAT). The draft survives eviction and is only cleared
// once the form has actually reached the done step.
const DRAFT_KEY = 'dues_apply_draft';

function loadDraft() {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || typeof d !== 'object') return null;
    return {
      form: { ...EMPTY_FORM, ...(d.form && typeof d.form === 'object' ? d.form : {}) },
    };
  } catch {
    return null;
  }
}

function clearDraft() {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* storage blocked — best effort */
  }
}

export default function Apply() {
  const [draft] = useState(loadDraft);
  const [form, setForm] = useState(draft?.form || EMPTY_FORM);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [reference, setReference] = useState(null);
  const [alreadyApplied, setAlreadyApplied] = useState(false);
  const [done, setDone] = useState(false);

  // Save the draft on every change; never save (or restore) the done state.
  useEffect(() => {
    if (done) return;
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ form }));
    } catch {
      /* storage full/blocked — persistence is best effort */
    }
  }, [done, form]);

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const normalizedNo = normalizeStudentNo(form.student_no);
    if (!normalizedNo) {
      setError('Enter your reference number.');
      return;
    }
    if (!/[A-Z]/.test(normalizedNo)) {
      setError(
        'That looks like a phone number — enter your reference number instead (e.g. UA2309264).'
      );
      return;
    }
    if (!REFERENCE_SHAPE_RE.test(normalizedNo)) {
      setError('Reference numbers only use letters, numbers, dots, slashes and dashes.');
      return;
    }
    if (!NAME_RE.test(form.full_name.trim())) {
      setError('Full name should contain letters only — no numbers, emoji or symbols.');
      return;
    }
    if (!PHONE_RE.test(form.phone.trim())) {
      setError('Phone number should contain numbers only.');
      return;
    }
    setSending(true);
    try {
      const res = await api.post('/public/freshers/apply', {
        full_name: form.full_name.trim(),
        student_no: normalizedNo,
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
        programme: form.programme.trim() || undefined,
        gender: form.gender || undefined,
        hometown: form.hometown.trim() || undefined,
      });
      setReference(res.data?.reference ?? null);
      clearDraft();
      setDone(true);
    } catch (err) {
      if (err.code === 'ECONNABORTED' || !err.response) {
        // Keep the draft exactly as-is so a retry never retypes 7 fields.
        setError('Your network is slow — tap Submit again, your details are saved.');
      } else if (err.response.status === 429) {
        setError(
          err.response.data?.error ||
            'Too many people are applying right now — wait a minute and try again.'
        );
      } else if (err.response.status === 409) {
        // Duplicate — they are already on the list. That is a success, not
        // an error: 409 from this endpoint only ever means "already applied".
        setReference(err.response.data?.reference ?? null);
        setAlreadyApplied(true);
        clearDraft();
        setDone(true);
      } else {
        setError(err.response?.data?.error || 'Something went wrong — please try again.');
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="apply-wrap">
      <div className="apply-card">
        <div className="apply-header">
          <img src="/school-logo.jpg" alt="School of Sciences" className="apply-logo" />
          <h1>Fresher Pre-Registration</h1>
          <p className="subtitle">School of Sciences · UENR Sunyani</p>
        </div>

        {!done ? (
          <form onSubmit={submit}>
            {error && (
              <div className="alert alert-error mb">
                <Warning size={16} style={{ marginRight: 6, verticalAlign: -3 }} /> {error}
              </div>
            )}
            <div className="grid grid-2">
              <div className="field">
                <label>Full Name *</label>
                <input
                  className="input"
                  value={form.full_name}
                  onChange={set('full_name')}
                  placeholder="As it appears on your documents"
                  maxLength={80}
                  required
                />
              </div>
              <div className="field">
                <label>Reference Number *</label>
                <input
                  className="input"
                  value={form.student_no}
                  onChange={set('student_no')}
                  placeholder="e.g. UA2309264"
                  maxLength={20}
                  required
                />
              </div>
              <div className="field">
                <label>Phone Number *</label>
                <input
                  className="input"
                  value={form.phone}
                  onChange={set('phone')}
                  placeholder="e.g. 0244 000 000"
                  maxLength={20}
                  required
                />
              </div>
              <div className="field">
                <label>Email Address</label>
                <input
                  className="input"
                  type="email"
                  value={form.email}
                  onChange={set('email')}
                  placeholder="name@example.com"
                  maxLength={120}
                />
                <p className="muted text-xs" style={{ marginTop: 6 }}>
                  Add your email to receive your receipt by email.
                </p>
              </div>
              <div className="field">
                <label>Programme of Choice *</label>
                <input
                  className="input"
                  value={form.programme}
                  onChange={set('programme')}
                  placeholder="e.g. BSc. Computer Science"
                  maxLength={100}
                  required
                />
              </div>
              <div className="field">
                <label>Gender *</label>
                <Select
                  value={form.gender}
                  onChange={(v) => setForm({ ...form, gender: v })}
                  options={GENDER_OPTIONS}
                  placeholder="Select gender..."
                  required
                />
              </div>
              <div className="field" style={{ gridColumn: '1 / -1' }}>
                <label>Hometown / Region *</label>
                <input
                  className="input"
                  value={form.hometown}
                  onChange={set('hometown')}
                  placeholder="e.g. Sunyani, Bono Region"
                  maxLength={80}
                  required
                />
              </div>
            </div>

            <div className="alert alert-info" style={{ marginBottom: 18 }}>
              <CheckCircle size={16} style={{ marginRight: 6, verticalAlign: -3 }} />
              No payment needed now — assignment happens on reporting day.
            </div>

            <div className="flex gap-sm">
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                disabled={
                  sending ||
                  !form.full_name.trim() ||
                  !form.student_no.trim() ||
                  !form.phone.trim() ||
                  !form.programme.trim() ||
                  !form.gender ||
                  !form.hometown.trim()
                }
              >
                <PaperPlaneTilt size={18} /> {sending ? 'Submitting...' : 'Submit'}
              </button>
            </div>
          </form>
        ) : (
          <div className="success-panel">
            <div className="success-icon">
              <CircleCheckFilled size={32} />
            </div>
            <h1 style={{ textAlign: 'center' }}>
              {alreadyApplied ? "You're already registered" : "You're on the list!"}
            </h1>
            <p
              className="subtitle"
              style={{ textAlign: 'center', maxWidth: 420, margin: '10px auto 0' }}
            >
              {alreadyApplied
                ? "You're already registered — nothing more to do. Your details are with the School of Sciences."
                : `Thanks${form.full_name.trim() ? `, ${form.full_name.trim().split(' ')[0]}` : ''}. The School of Sciences has received your details. On the reporting day, bring your admission documents — we will verify your information and assign you to your department.`}
            </p>
            {reference != null && (
              <div
                style={{
                  margin: '18px auto 0',
                  maxWidth: 420,
                  padding: '14px 16px',
                  border: '1px dashed var(--border)',
                  borderRadius: 10,
                  background: 'var(--bg)',
                  textAlign: 'center',
                }}
              >
                <strong style={{ fontSize: '1.25rem', letterSpacing: '-0.02em' }}>
                  Reference #{reference}
                </strong>
                <p className="muted text-sm" style={{ marginTop: 4 }}>
                  Screenshot this, or quote your reference number at reporting.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
