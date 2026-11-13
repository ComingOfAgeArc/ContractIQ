// Toggle chips for choosing several contracts. Nothing selected = "all".
export default function ContractPicker({ contracts, selected, onChange }) {
  const toggle = (id) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  if (!contracts.length) return <span className="text-sm text-slate-500">No embedded contracts yet.</span>;

  return (
    <div className="flex flex-wrap gap-2">
      {contracts.map((c) => (
        <label
          key={c._id}
          className={`cursor-pointer rounded border px-2 py-1 text-sm ${
            selected.includes(c._id) ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 hover:bg-slate-50'
          }`}
        >
          <input type="checkbox" className="sr-only" checked={selected.includes(c._id)} onChange={() => toggle(c._id)} />
          {c.vendor} {c.version}
        </label>
      ))}
    </div>
  );
}
