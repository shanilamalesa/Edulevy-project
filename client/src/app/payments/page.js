'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatKES } from '@/lib/money';

export default function PaymentsPage() {
  const router = useRouter();
  const [me, setMe] = useState(null);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(false);
  const [flash, setFlash] = useState(null);
  const esRef = useRef(null);

  async function refresh() {
    const res = await fetch('/api/payments');
    if (!res.ok) return;
    const json = await res.json();
    setPayments(json.data || []);
  }

  useEffect(() => {
    async function init() {
      const meRes = await fetch('/api/auth/me');
      if (!meRes.ok) return router.push('/login');
      setMe((await meRes.json()).data);

      await refresh();
      setLoading(false);

      // Open the live stream. Events are filtered by tenant on the server,
      // so this only ever receives this school's payments.
      const es = new EventSource('http://localhost:4000/api/events', {
      withCredentials: true,
    });
      es.onopen = () => setLive(true);
      es.onerror = () => setLive(false);

      es.addEventListener('payment.settled', (e) => {
        const payload = JSON.parse(e.data);
        setFlash({ tone: 'settled', ...payload });
        refresh();
        setTimeout(() => setFlash(null), 6000);
      });

      es.addEventListener('payment.failed', (e) => {
        const payload = JSON.parse(e.data);
        setFlash({ tone: 'failed', ...payload });
        refresh();
        setTimeout(() => setFlash(null), 6000);
      });
    }

    init();
    return () => esRef.current?.close();
  }, [router]);

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  }

  const statusTone = {
    settled: 'bg-green-50 text-green-700 border-green-200',
    pending: 'bg-amber-50 text-amber-700 border-amber-200',
    failed:  'bg-red-50 text-red-700 border-red-200',
  };

  if (loading) {
    return <main className="min-h-screen grid place-items-center text-slate-400 text-sm">Loading…</main>;
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="font-semibold text-slate-900">{me?.tenantName || 'EduLevy'}</h1>
            <p className="text-xs text-slate-500">Signed in as {me?.role}</p>
          </div>
          <nav className="flex items-center gap-4 text-sm">
            <a href="/fee-items" className="text-slate-500 hover:text-slate-900">Fees</a>
            <a href="/students" className="text-slate-500 hover:text-slate-900">Students</a>
            <a href="/payments" className="text-slate-900 font-medium">Payments</a>
            <button onClick={logout} className="text-slate-500 hover:text-slate-900">Sign out</button>
          </nav>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-slate-900">
            Payments <span className="text-slate-400 font-normal">({payments.length})</span>
          </h2>
          <div className="flex items-center gap-2 text-xs">
            <span className={`w-2 h-2 rounded-full ${live ? 'bg-green-500 animate-pulse' : 'bg-slate-300'}`} />
            <span className="text-slate-500">{live ? 'Live' : 'Reconnecting…'}</span>
          </div>
        </div>

        {flash && (
          <div className={`mb-4 px-4 py-3 rounded-xl border text-sm ${
            flash.tone === 'settled'
              ? 'bg-green-50 border-green-200 text-green-800'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}>
            {flash.tone === 'settled'
              ? `Payment received — receipt ${flash.receipt}`
              : `Payment failed — ${flash.reason}`}
          </div>
        )}

        {payments.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
            <p className="text-slate-500 text-sm">No payments yet.</p>
            <p className="text-slate-400 text-xs mt-1">
              They will appear here the moment a parent pays.
            </p>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left font-medium text-slate-600 px-5 py-3">Student</th>
                  <th className="text-left font-medium text-slate-600 px-5 py-3">Receipt</th>
                  <th className="text-left font-medium text-slate-600 px-5 py-3">When</th>
                  <th className="text-left font-medium text-slate-600 px-5 py-3">Status</th>
                  <th className="text-right font-medium text-slate-600 px-5 py-3">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {payments.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3">
                      {p.student_name
                        ? <>
                            <div className="text-slate-900 font-medium">{p.student_name}</div>
                            <div className="text-xs text-slate-400 font-mono">{p.admission_no}</div>
                          </>
                        : <span className="text-amber-600 text-xs">Unmatched</span>}
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-slate-500">
                      {p.provider_ref || '—'}
                    </td>
                    <td className="px-5 py-3 text-slate-500 text-xs">
                      {new Date(p.created_at).toLocaleString('en-GB')}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`inline-block px-2.5 py-1 rounded-md border text-xs font-medium ${statusTone[p.status]}`}>
                        {p.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right font-medium text-slate-900">
                      {formatKES(p.amount_minor)}
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