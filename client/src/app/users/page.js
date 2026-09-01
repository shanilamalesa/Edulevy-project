'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function UsersPage() {
  const router = useRouter();
  const [me, setMe] = useState(null);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function refresh() {
    const res = await fetch('/api/users');
    if (res.ok) setUsers((await res.json()).data || []);
  }

  useEffect(() => {
    async function load() {
      const meRes = await fetch('/api/auth/me');
      if (!meRes.ok) return router.push('/login');
      const meData = (await meRes.json()).data;
      setMe(meData);
      if (meData.role === 'manager') await refresh();
      setLoading(false);
    }
    load();
  }, [router]);

  async function act(id, action) {
    setError('');
    const res = await fetch(`/api/users/${id}/${action}`, { method: 'PATCH' });
    if (!res.ok) {
      const json = await res.json();
      return setError(json.error?.message || 'Could not update');
    }
    refresh();
  }

  if (loading) {
    return <main className="min-h-screen grid place-items-center text-slate-400 text-sm">Loading…</main>;
  }

  const isManager = me?.role === 'manager';
  const pending = users.filter((u) => u.status === 'pending');
  const rest = users.filter((u) => u.status !== 'pending');

  const statusTone = {
    active:      'bg-green-50 text-green-700',
    pending:     'bg-amber-50 text-amber-700',
    deactivated: 'bg-slate-100 text-slate-500',
  };

  return (
    <main className="min-h-screen bg-slate-50">
      <Nav active="accounts" me={me} />

      <div className="max-w-4xl mx-auto px-6 py-8">
        <h2 className="text-lg font-semibold text-slate-900 mb-2">Staff accounts</h2>
        <p className="text-xs text-slate-500 mb-6">
          Staff request an account themselves and set their own password, so nobody
          else ever knows it. A manager decides who is approved. Accounts are
          deactivated rather than deleted — anyone who approved a waiver or a payroll
          run must stay traceable in the audit log.
        </p>

        {!isManager ? (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
            <p className="text-sm text-amber-800 font-medium">Manager only</p>
            <p className="text-xs text-amber-700 mt-1">
              Approving and removing accounts is restricted to the manager.
              The API rejects it too, not just this page.
            </p>
          </div>
        ) : (
          <>
            {error && (
              <p className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            {pending.length > 0 && (
              <div className="mb-8">
                <h3 className="text-sm font-medium text-slate-700 mb-3">
                  Awaiting approval ({pending.length})
                </h3>
                <div className="bg-amber-50/50 border border-amber-200 rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <tbody className="divide-y divide-amber-100">
                      {pending.map((u) => (
                        <tr key={u.id}>
                          <td className="px-5 py-3 text-slate-900 font-medium">{u.email}</td>
                          <td className="px-5 py-3">
                            <span className="inline-block px-2 py-0.5 rounded bg-white text-slate-700 text-xs border border-slate-200">
                              {u.role}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-xs text-slate-500">
                            requested {new Date(u.created_at).toLocaleDateString('en-GB')}
                          </td>
                          <td className="px-5 py-3 text-right whitespace-nowrap">
                            <button
                              onClick={() => act(u.id, 'approve')}
                              className="text-xs bg-slate-900 text-white px-3 py-1.5 rounded mr-2"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => act(u.id, 'deactivate')}
                              className="text-xs text-slate-500 hover:text-slate-900"
                            >
                              Reject
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <h3 className="text-sm font-medium text-slate-700 mb-3">
              Accounts ({rest.length})
            </h3>
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left font-medium text-slate-600 px-5 py-3">Email</th>
                    <th className="text-left font-medium text-slate-600 px-5 py-3">Role</th>
                    <th className="text-left font-medium text-slate-600 px-5 py-3">Status</th>
                    <th className="px-5 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rest.map((u) => (
                    <tr key={u.id} className={u.status === 'deactivated'
                      ? 'bg-slate-50/50 text-slate-400' : 'hover:bg-slate-50'}>
                      <td className="px-5 py-3">
                        <span className={u.status === 'deactivated' ? '' : 'text-slate-900 font-medium'}>
                          {u.email}
                        </span>
                        {u.id === me.userId && <span className="ml-2 text-xs text-slate-400">(you)</span>}
                      </td>
                      <td className="px-5 py-3">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs ${
                          u.role === 'manager' ? 'bg-purple-50 text-purple-700' : 'bg-slate-100 text-slate-700'
                        }`}>
                          {u.role}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs ${statusTone[u.status]}`}>
                          {u.status}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        {u.id !== me.userId && (
                          <button
                            onClick={() => act(u.id, u.status === 'deactivated' ? 'reactivate' : 'deactivate')}
                            className="text-xs text-slate-400 hover:text-slate-900"
                          >
                            {u.status === 'deactivated' ? 'Reactivate' : 'Deactivate'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function Nav({ active, me }) {
  const link = (href, text) => (
    <a href={href} className={active === text.toLowerCase()
      ? 'text-slate-900 font-medium' : 'text-slate-500 hover:text-slate-900'}>{text}</a>
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
          {link('/guardians', 'Guardians')}
          {link('/payments', 'Payments')}
          {link('/fee-items', 'Fees')}
          {link('/adjustments', 'Adjustments')}
          {link('/staff', 'Staff')}
          {link('/payroll', 'Payroll')}
          {link('/users', 'Accounts')}
        </nav>
      </div>
    </header>
  );
}