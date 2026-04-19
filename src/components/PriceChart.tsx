import { useEffect, useRef } from 'preact/hooks';
import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Filler,
} from 'chart.js';

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Filler);

type Point = { label: string; value: number };

export default function PriceChart({ points, currency }: { points: Point[]; currency: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const chart = new Chart(canvasRef.current, {
      type: 'line',
      data: {
        labels: points.map((p) => p.label),
        datasets: [
          {
            data: points.map((p) => p.value),
            borderColor: '#c86f3d',
            backgroundColor: 'rgba(200, 111, 61, 0.12)',
            fill: true,
            tension: 0.3,
            pointBackgroundColor: '#fffdf6',
            pointBorderColor: '#c86f3d',
            pointBorderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            displayColors: false,
            callbacks: {
              title: (items) => (items[0] ? (items[0].label as string) : ''),
              label: (ctx) => `${currency} ${(ctx.parsed.y as number).toFixed(2)}`,
            },
          },
        },
        scales: {
          x: { display: false },
          y: { display: false },
        },
      },
    });
    return () => chart.destroy();
  }, [points, currency]);

  return (
    <div style={{ height: '50px', position: 'relative' }}>
      <canvas ref={canvasRef} />
    </div>
  );
}
