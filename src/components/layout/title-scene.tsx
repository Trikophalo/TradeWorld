import { MOON } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";

/*
 * The title screen behind sign-in and registration (ADR-108): a night sky with twinkling stars, a moon and the
 * skyline of the financial district, some windows still lit. Decoration only; every position is fixed, so the server
 * and the browser draw the same picture.
 */

/** Small deterministic generator: the same city on every render. */
function sequence(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

interface Building {
  x: number;
  w: number;
  h: number;
}

function skyline(seed: number, minH: number, maxH: number): Building[] {
  const next = sequence(seed);
  const out: Building[] = [];
  let x = -2;
  while (x < 200) {
    const w = 8 + Math.floor(next() * 11);
    out.push({ x, w, h: minH + Math.floor(next() * (maxH - minH)) });
    x += w + 1;
  }
  return out;
}

const FAR = skyline(7, 12, 28);
const NEAR = skyline(23, 5, 19);
/** Height of the skyline picture in its own units (200 wide). */
const GROUND = 30;
const STARS = (() => {
  const next = sequence(99);
  return Array.from({ length: 34 }, (_, i) => ({
    id: i,
    x: Math.round(next() * 1000) / 10,
    y: Math.round(next() * 620) / 10,
    big: next() > 0.8,
    delay: Math.round(next() * 30) / 10,
  }));
})();

export function TitleScene() {
  const lit = sequence(5);
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {STARS.map((star) => (
        <span
          key={star.id}
          className={`absolute animate-twinkle bg-fg-2 ${star.big ? "size-[3px]" : "size-0.5"}`}
          style={{ left: `${star.x}%`, top: `${star.y}%`, animationDelay: `${star.delay}s` }}
        />
      ))}
      <span className="absolute top-[5%] right-[8%] animate-float sm:top-[12%] sm:right-[14%]">
        <PixelIcon {...MOON} scale={4} className="sm:hidden" />
        <PixelIcon {...MOON} scale={5} className="hidden sm:block" />
      </span>
      <svg
        viewBox={`0 0 200 ${GROUND}`}
        className="absolute bottom-0 left-1/2 w-full min-w-160 -translate-x-1/2 [shape-rendering:crispEdges]"
      >
        {FAR.map((b) => (
          <rect key={`f${b.x}`} x={b.x} y={GROUND - b.h} width={b.w} height={b.h} fill="var(--bg-2)" />
        ))}
        {NEAR.map((b) => (
          <g key={`n${b.x}`}>
            <rect x={b.x} y={GROUND - b.h} width={b.w} height={b.h} fill="var(--bg-3)" />
            {Array.from({ length: Math.floor((b.h - 3) / 4) }, (_, row) =>
              Array.from({ length: Math.floor((b.w - 2) / 3) }, (_, col) => {
                const roll = lit();
                if (roll > 0.42) return null;
                return (
                  <rect
                    key={`${row}-${col}`}
                    x={b.x + 1.5 + col * 3}
                    y={GROUND - b.h + 2 + row * 4}
                    width={1.4}
                    height={1.8}
                    fill="var(--gold)"
                    opacity={0.75}
                    className={roll < 0.12 ? "animate-twinkle" : undefined}
                    style={roll < 0.12 ? { animationDelay: `${Math.round(roll * 400) / 10}s` } : undefined}
                  />
                );
              }),
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}
