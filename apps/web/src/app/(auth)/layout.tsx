import { AgentFigure } from "@/components/AgentFigure";
import { env } from "@/lib/env";
import { messages } from "@/lib/messages";

const PARADE = [
  { body: "triangle", color: "#EF5350", eyes: "suspicious", size: 54 },
  { body: "cloud", color: "#F25C8A", eyes: "happy", size: 62 },
  { body: "pebble", color: "#FF8A3D", eyes: "unimpressed", size: 76 },
  { body: "circle", color: "#3B93F0", eyes: "attentive", size: 92 },
  { body: "squircle", color: "#8B6CF6", eyes: "curious", size: 80 },
  { body: "capsule", color: "#3ECF8E", eyes: "proud", size: 64 },
  { body: "hexagon", color: "#2EC4C6", eyes: "neutral", size: 66 },
  { body: "droplet", color: "#F5C33B", eyes: "shy", size: 56 },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="sky-page min-h-screen flex flex-col items-center px-4 pt-[6vh] pb-0 overflow-hidden">
      <div className="w-full max-w-[400px] flex flex-col items-center gap-6 flex-1">
        <div className="sign-hero flex flex-col items-center gap-3 text-center">
          <div className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.02em] text-mist">
            <AgentFigure size={26} live={false} />
            {env.productName}
          </div>
          <p className="hero-line">{messages.product.tagline}</p>
        </div>
        {children}
      </div>
      <div className="parade mt-8 -mb-2 max-[520px]:scale-[.72] max-[520px]:origin-bottom" aria-hidden>
        {PARADE.map(({ size, ...look }, i) => (
          <AgentFigure key={i} size={size} look={look} state={i === 3 ? "listening" : "calm"} />
        ))}
      </div>
    </div>
  );
}
