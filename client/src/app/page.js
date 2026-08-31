export default function LandingPage() {
  return (
    <main className="min-h-screen bg-white">
      <header className="border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <span className="font-semibold text-slate-900">EduLevy</span>
          <a href="/login"
             className="bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-medium">
            Sign in
          </a>
        </div>
      </header>

      <section className="max-w-5xl mx-auto px-6 py-20">
        <h1 className="text-4xl font-semibold text-slate-900 max-w-2xl leading-tight">
          School fees, paid from any phone.
        </h1>
        <p className="text-lg text-slate-600 mt-4 max-w-2xl">
          No smartphone. No internet. No app. A parent dials a short code,
          pays with mobile money, and the school sees it the moment it lands.
        </p>
      </section>

      <section className="bg-slate-50 border-y border-slate-200">
        <div className="max-w-5xl mx-auto px-6 py-16 grid grid-cols-2 gap-12">
          <div>
            <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wide mb-3">
              The problem
            </h2>
            <p className="text-slate-700 leading-relaxed">
              A parent leaves work, travels to a bank branch, queues to pay, collects a
              printed receipt, and carries it to the school office as proof. The bursar
              writes each payment by hand into a ledger book. Working out who has paid
              means reading pages of handwriting.
            </p>
          </div>
          <div>
            <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wide mb-3">
              What EduLevy does
            </h2>
            <p className="text-slate-700 leading-relaxed">
              Replaces the bank queue with the parent&apos;s phone, and the ledger book with a
              screen that updates as money arrives. Several schools share one system, and
              no school can see another&apos;s records.
            </p>
          </div>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-6 py-16">
        <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wide mb-8">
          How a payment happens
        </h2>
        <div className="grid grid-cols-5 gap-4">
          {[
            ['1', 'Dial', 'Parent dials a short code and enters their school\u2019s three-digit number'],
            ['2', 'Identify', 'The system recognises their phone and shows only their own children'],
            ['3', 'Choose', 'They pick what to pay for and see what is outstanding'],
            ['4', 'Pay', 'An M-Pesa prompt arrives; they enter their PIN'],
            ['5', 'Appear', 'The payment lands on the school dashboard in real time'],
          ].map(([n, title, body]) => (
            <div key={n} className="border border-slate-200 rounded-xl p-5">
              <span className="text-xs font-mono text-slate-400">{n}</span>
              <h3 className="font-medium text-slate-900 mt-2">{title}</h3>
              <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-slate-50 border-y border-slate-200">
        <div className="max-w-5xl mx-auto px-6 py-16">
          <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wide mb-8">
            Who uses it
          </h2>
          <div className="grid grid-cols-3 gap-6">
            {[
              ['Parents', 'USSD or WhatsApp', 'Check what is owed and pay. They never see a website, and never type a student\u2019s number to view a balance.'],
              ['Bursar', 'Web dashboard', 'Day-to-day work: students, guardians, fee items, charges, and watching payments arrive.'],
              ['Manager', 'Web dashboard', 'Everything the bursar can do, plus the decisions that spend the school\u2019s money \u2014 waivers, bursaries, payroll approval.'],
            ].map(([who, how, what]) => (
              <div key={who}>
                <h3 className="font-semibold text-slate-900">{who}</h3>
                <p className="text-xs text-slate-500 mt-0.5">{how}</p>
                <p className="text-sm text-slate-600 mt-2 leading-relaxed">{what}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-6 py-16">
        <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wide mb-8">
          How it is built
        </h2>
        <div className="grid grid-cols-3 gap-6">
          {[
            ['Isolation enforced by the database',
             'Every row carries a school id, and PostgreSQL row-level security filters queries independently of the application. A query that forgets its WHERE clause returns nothing rather than everything.'],
            ['Balances are derived, never stored',
             'Balance is charges plus adjustments minus settled payments, calculated on read. Two payments arriving at once cannot overwrite each other, and overpayment becomes credit with no special case.'],
            ['Payments are idempotent',
             'M-Pesa retries a callback if it does not get a clear response. The receipt number carries a unique constraint, so a repeated delivery cannot credit a payment twice.'],
            ['Authorization without authentication',
             'USSD has no login. The calling number is supplied by the network and cannot be forged, and a join table decides which children it may see \u2014 so there is no admission number to enumerate.'],
            ['Sessions can be revoked',
             'Opaque session ids in Redis rather than JWTs. A JWT cannot be cancelled before it expires; deleting one Redis key ends access instantly.'],
            ['The audit log cannot be edited',
             'The application has permission to write audit rows and none to change or delete them. It is not that no delete route exists \u2014 the database refuses.'],
          ].map(([title, body]) => (
            <div key={title} className="border border-slate-200 rounded-xl p-5">
              <h3 className="font-medium text-slate-900 text-sm">{title}</h3>
              <p className="text-sm text-slate-600 mt-2 leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </section>
      <footer className="border-t border-slate-200">
        <div className="max-w-5xl mx-auto px-6 py-8 flex items-center justify-between text-sm">
          <p className="text-slate-500">
            Express · PostgreSQL · Redis · Next.js · M-Pesa Daraja · Africa&apos;s Talking · Twilio
          </p>
          <a href="/login" className="text-slate-900 font-medium hover:underline">
            Sign in →
          </a>
        </div>
      </footer>
    </main>
  );
}