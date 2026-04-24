import { useEffect, useState } from 'preact/hooks';
import { loadPortfolioSafe } from '@/data/portfolio-storage';
import type { PortfolioFile } from '@/data/portfolio-schema';

export default function PortfolioDashboard() {
  const [file, setFile] = useState<PortfolioFile | null>(null);

  useEffect(() => {
    const { file } = loadPortfolioSafe();
    setFile(file);
  }, []);

  if (file === null) return null;  // pre-hydration flash guard

  if (file.entries.length === 0) {
    return (
      <div class="portfolio-empty">
        <p>You haven't added any cards yet.</p>
        <p class="sub">Start by searching above, or paste an exported collection.</p>
        <style>{`
          .portfolio-empty {
            background: var(--paper);
            border: 1px solid #d9c9a3;
            border-radius: 10px;
            padding: 2rem 1.5rem;
            text-align: center;
            color: var(--ink);
          }
          .portfolio-empty p { margin: 0.25rem 0; }
          .portfolio-empty .sub { color: var(--muted); font-size: 0.9rem; }
        `}</style>
      </div>
    );
  }

  // Placeholder for Tasks 8-12 — non-empty rendering added progressively.
  return (
    <div class="portfolio-populated" />
  );
}
