import React from 'react';

export default function Chip({ ok, voided, voidText, children }) {
  const style = voided
    ? 'border-yellow-600 bg-yellow-950/60 text-yellow-300'
    : ok
    ? 'border-[#F0C72F] bg-[#F0C72F]/20 text-[#F0C72F]'
    : 'border-red-800 bg-red-950/50 text-red-400';
  return (
    <span className={`rounded border px-2 py-0.5 text-[11px] font-bold ${style}`}>
      {voided ? '– ' : ok ? '✓ ' : '✗ '}
      {children}
      {voided && voidText ? ` (${voidText})` : ''}
    </span>
  );
}
