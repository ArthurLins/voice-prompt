import { useEffect, useRef, useState, type ReactNode } from "react";

export default function SettingsScroll({
  children,
  labelledBy,
}: {
  children: ReactNode;
  labelledBy: string;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; top: number } | null>(null);
  const [metrics, setMetrics] = useState({ height: 0, full: 0, top: 0 });
  const measure = () => {
    const el = viewport.current;
    if (el)
      setMetrics({
        height: el.clientHeight,
        full: el.scrollHeight,
        top: el.scrollTop,
      });
  };
  useEffect(() => {
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    if (viewport.current) observer.observe(viewport.current);
    if (content.current) observer.observe(content.current);
    return () => observer.disconnect();
  }, []);
  const max = Math.max(0, metrics.full - metrics.height);
  const thumb = Math.min(
    metrics.height,
    Math.max(28, metrics.height ** 2 / (metrics.full || 1)),
  );
  const travel = metrics.height - thumb;
  return (
    <div className="settings-scroll-shell">
      <div
        ref={viewport}
        onScroll={measure}
        className="settings-viewport"
        id="settings-content"
        role="tabpanel"
        aria-labelledby={labelledBy}
      >
        <div ref={content} className="settings-content">
          {children}
        </div>
      </div>
      {max > 0 && (
        <div
          className="settings-scroll-track"
          style={{ height: metrics.height }}
        >
          <div
            className="settings-scroll-thumb"
            role="scrollbar"
            tabIndex={0}
            aria-label="Scroll settings"
            aria-controls="settings-content"
            aria-orientation="vertical"
            aria-valuemin={0}
            aria-valuemax={max}
            aria-valuenow={Math.round(metrics.top)}
            style={{
              height: thumb,
              transform: `translateY(${max ? (metrics.top / max) * travel : 0}px)`,
            }}
            onPointerDown={(e) => {
              drag.current = { y: e.clientY, top: metrics.top };
              e.currentTarget.setPointerCapture(e.pointerId);
              e.preventDefault();
            }}
            onPointerMove={(e) => {
              if (drag.current && viewport.current && travel > 0)
                viewport.current.scrollTop =
                  drag.current.top +
                  ((e.clientY - drag.current.y) / travel) * max;
            }}
            onPointerUp={(e) => {
              drag.current = null;
              e.currentTarget.releasePointerCapture(e.pointerId);
            }}
            onLostPointerCapture={() => {
              drag.current = null;
            }}
            onKeyDown={(e) => {
              const steps: Record<string, number> = {
                ArrowDown: 40,
                ArrowUp: -40,
                PageDown: metrics.height,
                PageUp: -metrics.height,
                Home: -max,
                End: max,
              };
              if (e.key in steps && viewport.current) {
                e.preventDefault();
                viewport.current.scrollTop += steps[e.key];
              }
            }}
          />
        </div>
      )}
    </div>
  );
}
