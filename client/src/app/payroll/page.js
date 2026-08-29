'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatKES } from '@/lib/money';

export default function PayrollPage() {
  const router = useRouter();
  const [me, setMe] = useState(null);
  const [runs, setRuns] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function refresh() {
    const res = await fetch('/api/payroll');
    if (res.ok) setRuns((await res.json()).data || []);
  }

  async function openRun(id) {
    const res = await fetch(`/api/payroll/${id}`);
    if (res.ok) setSelected((await res.json()).data);
  }

  useEffect(() => {
    async function load() {
      const meRes = await fetch('/api/auth/me');
      if (!meRes.ok) return router.push('/login');
      setMe((await meRes.json()).data);
      await refresh();
      setLoading(false);
    }
    load();
  }, [router]);

  async function createRun() {
    setError('');
    const now = new Date();
    const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    setBusy(true);
    const res = await fetch('/api/payroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ period }),
    });
    const json = await res.json();
    setBusy(false);

    if (!res.ok) return setError(json.error?.message || 'Could not create run');
    await refresh();
    openRun(json.data.id);
  }

  async function act(id, action) {
    setError('');
    setBusy(true);
    const res = await fetch(`/api/payroll/${id}/${action}`, { method: 'POST' });
    const json = await res.json();
    setBusy(false);

    if (!res.ok) return setError(json.error?.message || 'Could not update');
    await refresh();
    openRun(id);
  }

  if (loading) {
    return <main className="min-h-screen grid place-items-center text-slate-400 text-sm">Loading…</main>;
  }

  const isManager = me?.role === 'manager';

  const statusTone = {
    draft:    'bg-slate-100 text-slate-700 border-slate-200',
    approved: 'bg-amber-50 text-amber-700 border-amber-200',
    paid:     'bg-green-50 text-green-700 border-green-200',
  };

  return (
    <main className="min-h-screen bg-slate-50">
      <Nav active="payroll" me={me} />

      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold text-slate-900">Payroll</h2>
          {isManager && (
            <button
              onClick={createRun}
              disabled={busy}
              className="bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-lg
                         text-sm font-medium disabled:opacity-50"
            >
              Generate this month
            </button>
          )}
        </div>

        <p className="text-xs text-slate-500 mb-6">
          EduLevy records and approves salaries. It does not transfer funds —
          the school pays staff by its existing method and records it here.
        </p>

        {error && (
          <p className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        {runs.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
            <p className="text-slate-500 text-sm">No payroll runs yet.</p>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden mb-8">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left font-medium text-slate-600 px-5 py-3">Period</th>
                  <th className="text-left font-medium text-slate-600 px-5 py-3">Staff</th>
                  <th className="text-left font-medium text-slate-600 px-5 py-3">Status</th>
                  <th className="text-left font-medium text-slate-600 px-5 py-3">Approved by</th>
                  <th className="text-right font-medium text-slate-600 px-5 py-3">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {runs.map((r) => (
                  <tr key={r.id} onClick={() => openRun(r.id)}
                      className="hover:bg-slate-50 cursor-pointer">
                    <td className="px-5 py-3 font-medium text-slate-900">{r.period}</td>
                    <td className="px-5 py-3 text-slate-500">{r.staff_count}</td>
                    <td className="px-5 py-3">
                      <span className={`inline-block px-2.5 py-1 rounded-md border text-xs font-medium ${statusTone[r.status]}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-500 text-xs">
                      {r.approved_by_email || '—'}
                    </td>
                    <td className="px-5 py-3 text-right font-medium text-slate-900">
                      {formatKES(r.total_minor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {selected && (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-slate-900">{selected.period}</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {selected.approved_at && `Approved ${new Date(selected.approved_at).toLocaleString('en-GB')}`}
                  {selected.paid_at && ` · Paid ${new Date(selected.paid_at).toLocaleString('en-GB')}`}
                </p>
              </div>

              {isManager && (
                <div className="flex gap-2">
                  <button
                    onClick={() => act(selected.id, 'approve')}
                    disabled={busy || selected.status !== 'draft'}
                    className="px-4 py-2 rounded-lg text-sm font-medium border border-slate-300
                               disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => act(selected.id, 'mark-paid')}
                    disabled={busy || selected.status !== 'approved'}
                    className="px-4 py-2 rounded-lg text-sm font-medium bg-slate-900 text-white
                               disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-800"
                  >
                    Mark paid
                  </button>
                </div>
              )}
            </div>

            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left font-medium text-slate-600 px-5 py-3">Name</th>
                  <th className="text-left font-medium text-slate-600 px-5 py-3">Role</th>
                  <th className="text-left font-medium text-slate-600 px-5 py-3">Notified</th>
                  <th className="text-right font-medium text-slate-600 px-5 py-3">Gross</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {selected.lines?.map((l) => (
                  <tr key={l.id}>
                    <td className="px-5 py-3 text-slate-900">{l.full_name}</td>
                    <td className="px-5 py-3 text-slate-500">{l.role_title || '—'}</td>
                    <td className="px-5 py-3 text-xs text-slate-500">
                      {l.notified_at ? new Date(l.notified_at).toLocaleDateString('en-GB') : '—'}
                    </td>
                    <td className="px-5 py-3 text-right font-medium text-slate-900">
                      {formatKES(l.gross_minor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}

function Nav({ active, me }) {
  const link = (href, text) => (
    <a href={href}
       className={active === text.toLowerCase()
         ? 'text-slate-900 font-medium'
         : 'text-slate-500 hover:text-slate-900'}>
      {text}
    </a>
  );
  return (
    <header className="bg-white border-b border-slate-200">
      <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="font-semibold text-slate-900">{me?.tenantName || 'EduLevy'}</h1>
          <p className="text-xs text-slate-500">Signed in as {me?.role}</p>
        </div>
        <nav className="flex items-center gap-4 text-sm">
          {link('/students', 'Students')}
          {link('/payments', 'Payments')}
          {link('/fee-items', 'Fees')}
          {link('/adjustments', 'Adjustments')}
          {link('/payroll', 'Payroll')}
        </nav>
      </div>
    </header>
  );
}