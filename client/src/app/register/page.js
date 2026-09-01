'use client';

import { useState } from 'react';

export default function RegisterPage() {
  const [form, setForm] = useState({ tenantSlug: '', email: '', password: '', role: 'bursar' });
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);

  async function submit() {
    setError('');
    if (!form.tenantSlug.trim()) return setError('School code is required');
    if (!form.email.trim()) return setError('Email is required');
    if (form.password.length < 8) return setError('Password must be at least 8 characters');

    setSaving(true);
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const json = await res.json();
    setSaving(false);

    if (!res.ok) return setError(json.error?.message || 'Could not submit request');
    setDone(true);
  }

  if (done) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-sm text-center">
          <h1 className="text-2xl font-semibold text-slate-900">Request submitted</h1>
          <p className="text-sm text-slate-600 mt-3">
            A manager at your school will review it. You will be able to sign in
            once your account is approved.
          </p>
          <a href="/login" className="inline-block mt-6 text-sm text-slate-900 underline">
            Back to sign in
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-semibold text-slate-900">EduLevy</h1>
          <p className="text-sm text-slate-500 mt-1">Request a staff account</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-8 space-y-5">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">School code</label>
            <input
              value={form.tenantSlug}
              placeholder="green-hills"
              autoComplete="off"
              onChange={(e) => setForm({ ...form, tenantSlug: e.target.value })}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm
                         focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
            <p className="text-xs text-slate-400 mt-1">Ask your school office if unsure.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Email</label>
            <input
              type="email"
              value={form.email}
              placeholder="you@school.ac.ke"
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm
                         focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Role</label>
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white"
            >
              <option value="bursar">Bursar</option>
              <option value="manager">Manager</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Password</label>
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm
                         focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
            <p className="text-xs text-slate-400 mt-1">
              At least 8 characters. Only you will know it.
            </p>
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            onClick={submit}
            disabled={saving}
            className="w-full bg-slate-900 hover:bg-slate-800 text-white py-2.5 rounded-lg
                       text-sm font-medium transition disabled:opacity-50"
          >
            {saving ? 'Submitting…' : 'Request account'}
          </button>
        </div>

        <p className="text-center text-sm text-slate-500 mt-6">
          Already approved? <a href="/login" className="text-slate-900 underline">Sign in</a>
        </p>
      </div>
    </main>
  );
}