'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { formatKES } from '@/lib/money';

export default function StudentPage() {
  const router = useRouter();
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    async function load() {
      const meRes = await fetch('/api/auth/me');
      if (!meRes.ok) return router.push('/login');

      const res = await fetch(`/api/students/${id}/ledger`);
      if (res.status === 404) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      const json = await res.json();
      setData(json.data);
      setLoading(false);
    }
    load();
  }, [id, router]);

  if (loading) {
    return <main className="min-h-screen grid place-items-center text-slate-400 text-sm">Loading…</main>;
  }

  if (notFound) {
    return (
      <main className="min-h-screen grid place-items-center">
        <div className="text-center">
          <p className="text-slate-900 font-medium">Student not found</p>
          <p className="text-slate-500 text-sm mt-1">
            They may belong to another school.
          </p>
          <a href="/students" className="text-sm text-slate-900 underline mt-4 inline-block">
            Back to students
          </a>
        </div>
      </main>
    );
  }

  const { student, balance, entries } = data;
  const bal = Number(balance?.balance_minor || 0);

  // Running balance down the timeline
  const rows = entries.reduce((acc, e) => {
  const running = (acc.length ? acc[acc.length - 1].running : 0) + Number(e.amount_minor);
  acc.push({ ...e, running });
  return acc;
}, []);

  const typeTone = {
    charge:     'bg-slate-100 text-slate-700',
    payment:    'bg-green-50 text-green-700',
    adjustment: 'bg-purple-50 text-purple-700',
  };

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-6 py-4">
          <a href="/students" className="text-sm text-slate-500 hover:text-slate-900">
            ← Students
          </a>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-slate-900">{student.full_name}</h1>
          <p className="text-sm text-slate-500 mt-1">
            <span className="font-mono">{student.admission_no}</span>
            {student.class_label && ` · ${student.class_label}`}
          </p>
        </div>

        <div className="grid grid-cols-4 gap-3 mb-8">
          <Stat label="Charged"  value={formatKES(balance?.charged_minor)} />
          <Stat label="Paid"     value={formatKES(balance?.paid_minor)} />
          <Stat label="Adjusted" value={formatKES(balance?.adjusted_minor)} />
          <Stat
            label={bal < 0 ? 'In credit' : 'Outstanding'}
            value={formatKES(Math.abs(bal))}
            tone={bal < 0 ? 'credit' : bal === 0 ? 'paid' : 'owing'}
          />
        </div>

        <h2 className="text-sm font-medium text-slate-700 mb-3">Statement</h2>

        {rows.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
            <p className="text-slate-500 text-sm">No charges or payments yet.</p>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left font-medium text-slate-600 px-5 py-3">Date</th>
                  <th className="text-left font-medium text-slate-600 px-5 py-3">Type</th>
                  <th className="text-left font-medium text-slate-600 px-5 py-3">Detail</th>
                  <th className="text-right font-medium text-slate-600 px-5 py-3">Amount</th>
                  <th className="text-right font-medium text-slate-600 px-5 py-3">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((e) => {
                  const amount = Number(e.amount_minor);
                  return (
                    <tr key={`${e.type}-${e.id}`} className="hover:bg-slate-50">
                      <td className="px-5 py-3 text-slate-500 text-xs whitespace-nowrap">
                        {new Date(e.created_at).toLocaleDateString('en-GB')}
                      </td>
                      <td className="px-5 py-3">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${typeTone[e.type]}`}>
                          {e.category || e.type}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-slate-700">
                        {e.description}
                        {e.actor && (
                          <span className="block text-xs text-slate-400">by {e.actor}</span>
                        )}
                        {e.reference && (
                          <span className="block text-xs text-slate-400 font-mono">{e.reference}</span>
                        )}
                      </td>
                      <td className={`px-5 py-3 text-right font-medium ${
                        amount < 0 ? 'text-green-700' : 'text-slate-900'
                      }`}>
                        {amount < 0 ? '−' : '+'}{formatKES(Math.abs(amount))}
                      </td>
                      <td className="px-5 py-3 text-right text-slate-500">
                        {formatKES(Math.abs(e.running))}
                        {e.running < 0 && <span className="text-blue-600 text-xs ml-1">cr</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}

function Stat({ label, value, tone }) {
  const tones = {
    owing:  'text-red-700',
    paid:   'text-green-700',
    credit: 'text-blue-700',
  };
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-4 py-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`text-lg font-semibold mt-0.5 ${tones[tone] || 'text-slate-900'}`}>{value}</p>
    </div>
  );
}