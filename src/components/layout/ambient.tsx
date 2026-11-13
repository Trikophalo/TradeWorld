/** Pixel motes that drift up behind the game (ADR-108). Decoration only: fixed, click-through, behind everything. */
const MOTES = [
  { x: 6, size: 3, seconds: 46, delay: -4, tone: "bg-gold" },
  { x: 14, size: 2, seconds: 58, delay: -30, tone: "bg-accent" },
  { x: 23, size: 2, seconds: 52, delay: -17, tone: "bg-fg-3" },
  { x: 31, size: 3, seconds: 64, delay: -44, tone: "bg-accent" },
  { x: 42, size: 2, seconds: 49, delay: -9, tone: "bg-gold" },
  { x: 51, size: 2, seconds: 61, delay: -36, tone: "bg-fg-3" },
  { x: 60, size: 3, seconds: 55, delay: -22, tone: "bg-accent" },
  { x: 68, size: 2, seconds: 47, delay: -40, tone: "bg-gold" },
  { x: 77, size: 2, seconds: 66, delay: -13, tone: "bg-fg-3" },
  { x: 85, size: 3, seconds: 53, delay: -28, tone: "bg-accent" },
  { x: 93, size: 2, seconds: 59, delay: -48, tone: "bg-gold" },
] as const;

export function Ambient() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {MOTES.map((mote) => (
        <span
          key={mote.x}
          className={`absolute top-full animate-drift ${mote.tone}`}
          style={{
            left: `${mote.x}%`,
            width: mote.size,
            height: mote.size,
            animationDuration: `${mote.seconds}s`,
            animationDelay: `${mote.delay}s`,
          }}
        />
      ))}
    </div>
  );
}
