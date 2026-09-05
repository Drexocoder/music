const BARS = Array.from({ length: 28 }, (_, i) => i);

export function Visualizer({ active, compact = false }: { active: boolean; compact?: boolean }) {
  return (
    <div
      className={`flex items-end justify-center gap-[3px] ${compact ? "h-6" : "h-24"}`}
      aria-hidden
    >
      {BARS.map((i) => (
        <span
          key={i}
          className={`w-[3px] rounded-full bg-primary/80 ${active ? "animate-eq" : ""}`}
          style={{
            height: `${30 + Math.sin(i * 1.4) * 25 + (i % 5) * 8}%`,
            animationDelay: `${(i % 9) * 90}ms`,
            animationDuration: `${700 + (i % 6) * 130}ms`,
            opacity: active ? 1 : 0.25,
          }}
        />
      ))}
    </div>
  );
}
