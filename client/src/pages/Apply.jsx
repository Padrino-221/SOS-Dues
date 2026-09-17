import { useState } from 'react';
import api from '../api/client';
import { PaperPlaneTilt, ArrowRight, ArrowLeft, CheckCircle, Warning } from '@phosphor-icons/react';
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

export default function Apply() {
  // code → form → done
  const [step, setStep] = useState('code');
  const [code, setCode] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [checkingCode, setCheckingCode] = useState(false);

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const start = async (e) => {
    e.preventDefault();
    if (!code.trim()) {
      setError('Enter the access code the school shared with you.');
      return;
    }
    setError('');
    setCheckingCode(true);
    try {
      await api.post('/public/freshers/apply/check-code', { code: code.trim() });
      setStep('form');
    } catch (err) {
      setError(
        err.response?.data?.error ||
          'Invalid access code. Please check with the School of Sciences.'
      );
    } finally {
      setCheckingCode(false);
    }
  };

  const backToCode = () => {
    setError('');
    setStep('code');
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSending(true);
    try {
      await api.post('/public/freshers/apply', {
        code: code.trim(),
        full_name: form.full_name.trim(),
        student_no: form.student_no.trim(),
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
        programme: form.programme.trim() || undefined,
        gender: form.gender || undefined,
        hometown: form.hometown.trim() || undefined,
      });
      setStep('done');
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong — please try again.');
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

        {/* ─── Step 1: access code ─── */}
        {step === 'code' && (
          <form onSubmit={start}>
            {error && (
              <div className="alert alert-error mb">
                <Warning size={16} style={{ marginRight: 6, verticalAlign: -3 }} /> {error}
              </div>
            )}
            <div className="field">
              <label>Access Code *</label>
              <input
                className="input"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Enter the code given by the school"
                autoComplete="off"
                autoFocus
              />
              <p className="muted text-xs" style={{ marginTop: 6 }}>
                Enter the code the school shared with you.
              </p>
            </div>
            <button className="btn btn-primary w-full" disabled={checkingCode}>
              <ArrowRight size={18} /> {checkingCode ? 'Checking...' : 'Continue'}
            </button>
          </form>
        )}

        {/* ─── Step 2: personal details ─── */}
        {step === 'form' && (
          <form onSubmit={submit}>
            {error && (
              <div className="alert alert-error mb">
                <Warning size={16} style={{ marginRight: 6, verticalAlign: -3 }} /> {error}
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  style={{ marginLeft: 8 }}
                  onClick={backToCode}
                >
                  <ArrowLeft size={12} /> Change access code
                </button>
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
                  required
                />
              </div>
              <div className="field">
                <label>Reference Number *</label>
                <input
                  className="input"
                  value={form.student_no}
                  onChange={set('student_no')}
                  placeholder="e.g. REF-2026-00123"
                  required
                />
              </div>
              <div className="field">
                <label>Phone Number</label>
                <input
                  className="input"
                  value={form.phone}
                  onChange={set('phone')}
                  placeholder="e.g. 0244 000 000"
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
                />
              </div>
              <div className="field">
                <label>Programme of Choice</label>
                <input
                  className="input"
                  value={form.programme}
                  onChange={set('programme')}
                  placeholder="e.g. BSc. Computer Science"
                />
              </div>
              <div className="field">
                <label>Gender</label>
                <Select
                  value={form.gender}
                  onChange={(v) => setForm({ ...form, gender: v })}
                  options={GENDER_OPTIONS}
                  placeholder="Select gender..."
                />
              </div>
              <div className="field" style={{ gridColumn: '1 / -1' }}>
                <label>Hometown / Region</label>
                <input
                  className="input"
                  value={form.hometown}
                  onChange={set('hometown')}
                  placeholder="e.g. Sunyani, Bono Region"
                />
              </div>
            </div>

            <div className="alert alert-info" style={{ marginBottom: 18 }}>
              <CheckCircle size={16} style={{ marginRight: 6, verticalAlign: -3 }} />
              No payment needed now — assignment happens on reporting day.
            </div>

            <div
              className="flex gap-sm"
              style={{ justifyContent: 'space-between', alignItems: 'center' }}
            >
              <button type="button" className="btn btn-outline" onClick={backToCode}>
                <ArrowLeft size={18} /> Back
              </button>
              <button
                className="btn btn-primary"
                disabled={sending || !form.full_name.trim() || !form.student_no.trim()}
              >
                <PaperPlaneTilt size={18} /> {sending ? 'Submitting...' : 'Submit'}
              </button>
            </div>
          </form>
        )}

        {/* ─── Step 3: done ─── */}
        {step === 'done' && (
          <div className="success-panel">
            <div className="success-icon">
              <CheckCircle size={32} weight="fill" />
            </div>
            <h1 style={{ textAlign: 'center' }}>You're on the list!</h1>
            <p
              className="subtitle"
              style={{ textAlign: 'center', maxWidth: 420, margin: '10px auto 0' }}
            >
              Thanks{form.full_name.trim() ? `, ${form.full_name.trim().split(' ')[0]}` : ''}. The
              School of Sciences has received your details. On the reporting day, bring your
              admission documents — we will verify your information and assign you to your
              department.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
