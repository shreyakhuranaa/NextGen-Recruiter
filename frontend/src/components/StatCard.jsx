export function StatCard({ label, value, hint }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-bold text-ink">{value}</p>
      {hint ? <p className="mt-2 text-xs uppercase tracking-[0.18em] text-brand">{hint}</p> : null}
    </div>
  );
}
