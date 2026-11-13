import { NavLink, Route, Routes } from 'react-router';
import ContractsPage from './pages/ContractsPage.jsx';
import ContractDetailPage from './pages/ContractDetailPage.jsx';
import AskPage from './pages/AskPage.jsx';
import SearchPage from './pages/SearchPage.jsx';
import ComparePage from './pages/ComparePage.jsx';
import FlagsPage from './pages/FlagsPage.jsx';

const navClass = ({ isActive }) =>
  `rounded px-3 py-1.5 text-sm ${isActive ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`;

export default function App() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div>
            <h1 className="text-xl font-semibold">ContractIQ</h1>
            <p className="text-sm text-slate-500">Contract intelligence &amp; comparison</p>
          </div>
          <nav className="flex flex-wrap gap-1">
            <NavLink to="/" end className={navClass}>Contracts</NavLink>
            <NavLink to="/search" className={navClass}>Search</NavLink>
            <NavLink to="/ask" className={navClass}>Ask</NavLink>
            <NavLink to="/compare" className={navClass}>Compare</NavLink>
            <NavLink to="/flags" className={navClass}>Flags</NavLink>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Routes>
          <Route path="/" element={<ContractsPage />} />
          <Route path="/contracts/:id" element={<ContractDetailPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/ask" element={<AskPage />} />
          <Route path="/compare" element={<ComparePage />} />
          <Route path="/flags" element={<FlagsPage />} />
          <Route path="*" element={<p>Page not found.</p>} />
        </Routes>
      </main>
      <footer className="mx-auto max-w-5xl px-4 pb-8 text-xs text-slate-400">
        ContractIQ provides AI-assisted contract analysis for review. It is not legal advice; always check the cited contract text.
      </footer>
    </div>
  );
}
