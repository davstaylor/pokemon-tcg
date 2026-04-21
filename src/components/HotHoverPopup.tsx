import { useEffect, useRef } from 'preact/hooks';

// Dimensions kept in sync with the CSS below. POPUP_WIDTH is used to decide
// which side of the row to pin the popup to.
const POPUP_WIDTH = 290;
const POPUP_GAP = 12;
const VIEWPORT_MARGIN = 12;

type HoverData = {
  name: string;
  set: string;
  current: number;
  deltaEur: number;
  deltaPct: number;
  image: string;
  history: number[];
};

function parseRow(row: HTMLElement): HoverData | null {
  const raw = row.dataset.history;
  if (!raw) return null;
  let history: number[];
  try {
    history = JSON.parse(raw);
  } catch {
    return null;
  }
  return {
    name: row.dataset.cardName ?? '',
    set: row.dataset.setName ?? '',
    current: Number(row.dataset.current ?? 0),
    deltaEur: Number(row.dataset.deltaEur ?? 0),
    deltaPct: Number(row.dataset.deltaPct ?? 0),
    image: row.dataset.image ?? '',
    history,
  };
}

function buildSparklinePoints(history: number[]): string {
  if (history.length < 2) return '';
  const min = Math.min(...history);
  const max = Math.max(...history);
  const range = max - min || 1;
  return history
    .map((v, i) => {
      const x = (i / (history.length - 1)) * 100;
      const y = 48 - ((v - min) / range) * 48;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

const eurFmt = new Intl.NumberFormat('en-IE', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
function fmtEur(v: number): string { return eurFmt.format(v); }
function fmtEurSigned(v: number): string {
  const sign = v >= 0 ? '+' : '−';
  return `${sign}${eurFmt.format(Math.abs(v))}`;
}
function fmtPct(v: number): string {
  const pct = (v * 100).toFixed(0);
  const sign = v >= 0 ? '+' : '−';
  return `${sign}${pct.replace('-', '')}%`;
}

export default function HotHoverPopup() {
  const popupRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!popupRef.current) return;
    const popup = popupRef.current;

    // Shared element references inside the popup — cached on first render
    // so hover handlers don't re-query.
    const img = popup.querySelector('img') as HTMLImageElement;
    const placeholder = popup.querySelector('.pop-img-placeholder') as HTMLDivElement;
    const nameEl = popup.querySelector('.pop-name') as HTMLElement;
    const setEl = popup.querySelector('.pop-set') as HTMLElement;
    const priceEl = popup.querySelector('.pop-price') as HTMLElement;
    const deltaEl = popup.querySelector('.pop-delta') as HTMLElement;
    const rangeEl = popup.querySelector('.pop-range') as HTMLElement;
    const polyline = popup.querySelector('polyline') as SVGPolylineElement;

    let currentRow: HTMLElement | null = null;

    function show(row: HTMLElement) {
      const data = parseRow(row);
      if (!data) return;

      // Image handling — clear-on-error reveals the placeholder.
      if (data.image) {
        img.src = data.image;
        img.style.display = '';
        placeholder.style.display = 'none';
        img.onerror = () => {
          img.style.display = 'none';
          placeholder.style.display = '';
        };
      } else {
        img.removeAttribute('src');
        img.style.display = 'none';
        placeholder.style.display = '';
      }

      nameEl.textContent = data.name;
      setEl.textContent = data.set;
      priceEl.textContent = fmtEur(data.current);
      const deltaStr = `${fmtEurSigned(data.deltaEur)} (${fmtPct(data.deltaPct)})`;
      deltaEl.textContent = deltaStr;
      deltaEl.classList.toggle('up', data.deltaEur >= 0);
      deltaEl.classList.toggle('dn', data.deltaEur < 0);
      polyline.setAttribute('points', buildSparklinePoints(data.history));
      polyline.setAttribute('stroke', data.deltaEur >= 0 ? '#2d7d47' : '#b23a3a');

      const min = Math.min(...data.history);
      const max = Math.max(...data.history);
      rangeEl.textContent = `Min ${fmtEur(min)}  ·  30 days  ·  Max ${fmtEur(max)}`;

      // Position: prefer right of the row; flip to left if not enough room.
      const rowRect = row.getBoundingClientRect();
      const viewportW = window.innerWidth;
      const spaceRight = viewportW - rowRect.right - VIEWPORT_MARGIN;
      const flipLeft = spaceRight < POPUP_WIDTH + POPUP_GAP;
      const left = flipLeft
        ? rowRect.left - POPUP_WIDTH - POPUP_GAP
        : rowRect.right + POPUP_GAP;
      const top = rowRect.top + window.scrollY;
      popup.style.left = `${Math.max(VIEWPORT_MARGIN, left)}px`;
      popup.style.top = `${top}px`;
      popup.classList.add('visible');
      popup.removeAttribute('aria-hidden');

      currentRow = row;
    }

    function hide() {
      popup.classList.remove('visible');
      popup.setAttribute('aria-hidden', 'true');
      currentRow = null;
    }

    function onMouseOver(e: MouseEvent) {
      const target = (e.target as HTMLElement | null)?.closest('.hot-row') as HTMLElement | null;
      if (!target) return;
      if (target !== currentRow) show(target);
    }
    function onMouseOut(e: MouseEvent) {
      const target = (e.target as HTMLElement | null)?.closest('.hot-row') as HTMLElement | null;
      if (!target) return;
      // Only hide when moving OUT of the row AND not into another .hot-row.
      const related = (e.relatedTarget as HTMLElement | null)?.closest('.hot-row');
      if (!related) hide();
    }
    function onFocusIn(e: FocusEvent) {
      const target = (e.target as HTMLElement | null)?.closest('.hot-row') as HTMLElement | null;
      if (!target) return;
      show(target);
    }
    function onFocusOut(e: FocusEvent) {
      // Symmetric with onMouseOut: don't hide if focus is moving to another
      // row (otherwise Tab-walking the list flickers the popup off/on).
      const related = (e.relatedTarget as HTMLElement | null)?.closest('.hot-row');
      if (!related) hide();
    }

    // Tap-to-toggle on touch devices: a tap that's also a click navigates,
    // so we only preview the popup on touchstart before the click fires.
    function onTouchStart(e: TouchEvent) {
      const target = (e.target as HTMLElement | null)?.closest('.hot-row') as HTMLElement | null;
      if (!target) return;
      show(target);
    }

    document.addEventListener('mouseover', onMouseOver);
    document.addEventListener('mouseout', onMouseOut);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('touchstart', onTouchStart, { passive: true });

    return () => {
      document.removeEventListener('mouseover', onMouseOver);
      document.removeEventListener('mouseout', onMouseOut);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('touchstart', onTouchStart);
    };
  }, []);

  return (
    <div class="hot-popup" ref={popupRef} role="tooltip" aria-hidden="true">
      <div class="pop-left">
        <img alt="" />
        <div class="pop-img-placeholder" />
      </div>
      <div class="pop-right">
        <p class="pop-name" />
        <p class="pop-set" />
        <div class="pop-prices">
          <span class="pop-price" />
          <span class="pop-delta" />
        </div>
        <div class="pop-spark">
          <svg viewBox="0 0 100 48" preserveAspectRatio="none">
            <polyline points="" fill="none" stroke="#2d7d47" stroke-width="1.5" />
          </svg>
        </div>
        <p class="pop-range" />
        <p class="pop-foot">Click row to open card →</p>
      </div>
      <style>{`
        .hot-popup {
          position: absolute;
          display: flex;
          gap: 12px;
          width: ${POPUP_WIDTH}px;
          padding: 12px;
          background: #fffdf6;
          border: 1px solid #d9c9a3;
          border-radius: 10px;
          box-shadow: 0 10px 30px rgba(59, 42, 26, 0.18);
          pointer-events: none;
          opacity: 0;
          transition: opacity 80ms ease;
          z-index: 1000;
        }
        .hot-popup.visible { opacity: 1; }
        .hot-popup .pop-left { width: 96px; flex-shrink: 0; position: relative; }
        .hot-popup img {
          width: 96px; aspect-ratio: 2/3;
          object-fit: cover; border-radius: 6px; display: block;
        }
        .hot-popup .pop-img-placeholder {
          width: 96px; aspect-ratio: 2/3; border-radius: 6px;
          background: linear-gradient(135deg, #fffdf6, #e8ddc6);
          border: 1px dashed #c8b78f;
          display: none;
        }
        .hot-popup .pop-right { flex: 1; min-width: 0; display: flex; flex-direction: column; }
        .hot-popup .pop-name { font-weight: 600; font-size: 0.95rem; margin: 0 0 2px; }
        .hot-popup .pop-set { color: var(--muted); font-size: 0.75rem; margin: 0 0 8px; }
        .hot-popup .pop-prices { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px; }
        .hot-popup .pop-price { font-size: 1.2rem; font-weight: 700; font-variant-numeric: tabular-nums; }
        .hot-popup .pop-delta { font-size: 0.85rem; font-weight: 600; font-variant-numeric: tabular-nums; }
        .hot-popup .pop-delta.up { color: #2d7d47; }
        .hot-popup .pop-delta.dn { color: #b23a3a; }
        .hot-popup .pop-spark {
          height: 48px;
          background: linear-gradient(180deg, #fffdf6, #f5efe2);
          border-radius: 4px;
          overflow: hidden;
          border: 1px solid #ebdfc2;
        }
        .hot-popup .pop-spark svg { display: block; width: 100%; height: 100%; }
        .hot-popup .pop-range {
          display: flex; justify-content: space-between;
          font-size: 0.7rem; color: var(--muted); margin: 4px 0 0;
        }
        .hot-popup .pop-foot {
          text-align: center; font-size: 0.7rem; color: var(--accent);
          margin: 6px 0 0; padding-top: 6px; border-top: 1px solid #ebdfc2;
        }
      `}</style>
    </div>
  );
}
