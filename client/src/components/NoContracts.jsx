import { Link } from 'react-router';

// Shown on Search / Ask / Compare when no contract is ready yet
export default function NoContracts({ what }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
      <p className="font-medium text-slate-700">No processed contracts yet</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
        {what} needs at least one contract that has finished processing.
      </p>
      <Link to="/" className="mt-3 inline-block rounded bg-slate-900 px-4 py-2 text-sm text-white">
        Upload contracts
      </Link>
    </div>
  );
}
