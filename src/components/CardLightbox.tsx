import { useEffect, useRef, useState } from 'preact/hooks';
import type { RarityTier } from '@/data/rarity-tier';

interface Props {
  imageUrl: string;
  cardName: string;
  setName: string;
  rarityTier: RarityTier;
}

// Clamp vertical rotation to keep the card from ever flipping past its own
// edge — dragging "all the way up" still shows the face. Horizontal has no
// cap so users can spin through the card back.
const MAX_RX = 60;
const DRAG_X_SPEED = 0.6;
const DRAG_Y_SPEED = 0.5;

export default function CardLightbox({ imageUrl, cardName, setName, rarityTier }: Props) {
  const [open, setOpen] = useState(false);
  const [rot, setRot] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const dragStart = useRef({ px: 0, py: 0, rx: 0, ry: 0 });

  // Escape to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Lock page scroll while the lightbox is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Drag listeners are global only while dragging so unrelated mouse traffic
  // doesn't pay for event handlers.
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStart.current.px;
      const dy = e.clientY - dragStart.current.py;
      setRot({
        x: Math.max(-MAX_RX, Math.min(MAX_RX, dragStart.current.rx - dy * DRAG_Y_SPEED)),
        y: dragStart.current.ry + dx * DRAG_X_SPEED,
      });
    };
    const onUp = () => setDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging]);

  function onCardDown(e: MouseEvent) {
    setDragging(true);
    dragStart.current = { px: e.clientX, py: e.clientY, rx: rot.x, ry: rot.y };
  }

  function reset() {
    setRot({ x: 0, y: 0 });
    setFlipped(false);
  }

  return (
    <>
      <button
        type="button"
        class={`cl-trigger rarity-${rarityTier}`}
        onClick={() => setOpen(true)}
        aria-label="View card in 3D"
      >
        <span class="cl-trigger-icon" aria-hidden="true">⟳</span>
        <span class="cl-trigger-text">View in 3D</span>
      </button>

      {open && (
        <div class="cl-backdrop" onClick={() => setOpen(false)}>
          <div class="cl-modal" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              class="cl-close"
              aria-label="Close"
              onClick={() => setOpen(false)}
            >×</button>

            <div class="cl-stage">
              <div
                class={`cl-card-wrap rarity-${rarityTier}`}
                onMouseDown={onCardDown}
                style={{
                  transform: `perspective(1600px) rotateX(${rot.x}deg) rotateY(${rot.y + (flipped ? 180 : 0)}deg)`,
                  cursor: dragging ? 'grabbing' : 'grab',
                  transition: dragging ? 'none' : 'transform 0.5s cubic-bezier(0.2, 0.8, 0.2, 1)',
                }}
              >
                <div class="cl-face cl-front">
                  <img
                    src={imageUrl}
                    alt={cardName}
                    draggable={false}
                    onError={(e) => {
                      const img = e.currentTarget as HTMLImageElement;
                      img.style.display = 'none';
                    }}
                  />
                  {/* Holo overlays — visible on foil+ cards while dragging. */}
                  {rarityTier !== 'common' && (
                    <div class="cl-holo cl-holo-band" aria-hidden="true" />
                  )}
                  {rarityTier !== 'common' && dragging && (
                    <div class="cl-holo cl-holo-prism" aria-hidden="true" />
                  )}
                </div>
                <div class="cl-face cl-back">
                  <CardBack />
                </div>
              </div>

              <div class="cl-meta">
                <strong>{cardName}</strong>
                <span>{setName}</span>
              </div>

              <p class="cl-hint">
                Drag to rotate ·{' '}
                <button type="button" class="cl-linklike" onClick={() => setFlipped((f) => !f)}>
                  {flipped ? 'flip back' : 'flip'}
                </button>
                {' '}·{' '}
                <button type="button" class="cl-linklike" onClick={reset}>reset</button>
              </p>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .cl-trigger {
          display: inline-flex;
          align-items: center;
          gap: 0.4rem;
          padding: 0.5rem 1rem;
          border: 1px solid var(--accent);
          border-radius: 999px;
          background: transparent;
          color: var(--accent);
          font-size: 0.9rem;
          font-weight: 600;
          cursor: pointer;
          margin: 0.75rem 0;
          transition: background 150ms ease, color 150ms ease, transform 150ms ease;
        }
        .cl-trigger:hover {
          background: var(--accent);
          color: white;
          transform: translateY(-1px);
        }
        .cl-trigger-icon {
          display: inline-block;
          font-size: 1rem;
          line-height: 1;
        }
        .cl-trigger:hover .cl-trigger-icon {
          animation: cl-spin 800ms cubic-bezier(0.3, 0, 0.4, 1);
        }
        @keyframes cl-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

        .cl-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(8, 5, 2, 0.78);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          z-index: 1000;
          display: grid;
          place-items: center;
          padding: 24px;
          animation: cl-fade-in 250ms ease;
        }
        @keyframes cl-fade-in { from { opacity: 0; } }

        .cl-modal {
          position: relative;
          max-width: 960px;
          width: 100%;
          max-height: 94vh;
          background: transparent;
          border-radius: 16px;
          padding: 12px 28px 24px;
          overflow: visible;
          animation: cl-slide-up 320ms cubic-bezier(0.2, 0.8, 0.2, 1);
        }
        @keyframes cl-slide-up { from { transform: translateY(18px); opacity: 0; } }

        .cl-close {
          position: absolute;
          top: 8px;
          right: 12px;
          width: 40px;
          height: 40px;
          font-size: 26px;
          line-height: 1;
          color: rgba(255, 255, 255, 0.75);
          background: transparent;
          border: 0;
          border-radius: 8px;
          cursor: pointer;
          transition: background 120ms ease, color 120ms ease;
        }
        .cl-close:hover { background: rgba(255, 255, 255, 0.08); color: white; }

        .cl-stage {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 16px;
          perspective: 2000px;
          padding: 12px 0;
        }

        .cl-card-wrap {
          transform-style: preserve-3d;
          position: relative;
          width: min(440px, 70vh * 0.71);
          aspect-ratio: 5 / 7;
          user-select: none;
          -webkit-user-select: none;
          will-change: transform;
        }

        .cl-face {
          position: absolute;
          inset: 0;
          backface-visibility: hidden;
          border-radius: 14px;
          overflow: hidden;
          box-shadow: 0 30px 60px -20px rgba(0, 0, 0, 0.55);
        }
        .cl-front { background: #1a1208; }
        .cl-front img { width: 100%; height: 100%; object-fit: contain; display: block; }
        .cl-back { transform: rotateY(180deg); }

        .cl-holo {
          position: absolute;
          inset: 0;
          pointer-events: none;
        }
        .cl-holo-band {
          background: linear-gradient(
            115deg,
            transparent 20%,
            rgba(255, 255, 255, 0.16) 40%,
            rgba(255, 180, 255, 0.22) 50%,
            rgba(180, 220, 255, 0.2) 55%,
            transparent 75%
          );
          mix-blend-mode: screen;
          opacity: 0.55;
        }
        .cl-holo-prism {
          background: radial-gradient(
            circle at 50% 35%,
            rgba(255, 255, 255, 0.4) 0%,
            rgba(255, 200, 255, 0.18) 20%,
            rgba(150, 220, 255, 0.15) 35%,
            transparent 60%
          );
          mix-blend-mode: color-dodge;
        }

        .cl-meta {
          text-align: center;
          color: rgba(255, 253, 246, 0.92);
          font-size: 0.95rem;
          line-height: 1.3;
        }
        .cl-meta strong { display: block; font-size: 1.15rem; font-weight: 600; }
        .cl-meta span { color: rgba(255, 253, 246, 0.6); font-size: 0.85rem; }

        .cl-hint {
          font-size: 0.8rem;
          color: rgba(255, 253, 246, 0.55);
          margin: 0;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        }
        .cl-linklike {
          color: var(--accent);
          text-decoration: underline;
          background: transparent;
          border: 0;
          cursor: pointer;
          font: inherit;
          padding: 0;
        }

        /* Generic TCG card back — original design, no third-party IP. */
        .cl-back-design {
          width: 100%;
          height: 100%;
          background:
            radial-gradient(circle at 50% 40%, #5a3a1a 0%, #2a1a08 60%, #100804 100%);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 18px;
          color: #fffdf6;
          padding: 32px;
          box-sizing: border-box;
        }
        .cl-back-mark {
          font-size: 110px;
          line-height: 1;
          color: #ffc36b;
          text-shadow: 0 0 22px rgba(255, 195, 107, 0.55);
          margin-bottom: 4px;
          font-family: Georgia, serif;
        }
        .cl-back-word {
          letter-spacing: 0.3em;
          font-weight: 600;
          font-size: 0.95rem;
          font-family: Georgia, serif;
        }
        .cl-back-sub {
          letter-spacing: 0.45em;
          font-size: 0.68rem;
          opacity: 0.65;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          margin-top: 4px;
        }

        @media (prefers-reduced-motion: reduce) {
          .cl-backdrop, .cl-modal { animation: none; }
          .cl-card-wrap { transition: none !important; }
          .cl-trigger:hover .cl-trigger-icon { animation: none; }
        }

        @media (max-width: 600px) {
          .cl-card-wrap { width: min(320px, 62vh * 0.71); }
          .cl-modal { padding: 12px 16px 16px; }
        }
      `}</style>
    </>
  );
}

function CardBack() {
  return (
    <div class="cl-back-design">
      <div class="cl-back-mark">✦</div>
      <div class="cl-back-word">TCG CATALOG</div>
      <div class="cl-back-sub">POKÉMON</div>
    </div>
  );
}
