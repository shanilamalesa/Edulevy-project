// The API sends amounts as integer cents. Divide by 100 for display.
export function formatKES(minor) {
  const n = Number(minor || 0) / 100;
  return 'KES ' + n.toLocaleString('en-KE', { minimumFractionDigits: 0 });
}

// A negative balance is a credit, not an error
export function balanceLabel(minor) {
  const n = Number(minor || 0);
  if (n < 0) return { text: formatKES(-n) + ' credit', tone: 'credit' };
  if (n === 0) return { text: 'Paid', tone: 'paid' };
  return { text: formatKES(n), tone: 'owing' };
}