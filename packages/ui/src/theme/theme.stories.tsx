import { RAMP_STOPS } from "./ramp";

const SEMANTIC = [
  "background", "foreground", "primary", "primary-foreground", "primary-hover",
  "secondary", "muted", "accent", "accent-foreground", "destructive", "border",
  "ring", "chat-user-bubble", "chat-user-bubble-foreground",
];

function Swatch({ label, varName }: { label: string; varName: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "system-ui", fontSize: 12 }}>
      <span
        style={{
          width: 40, height: 24, borderRadius: 4, border: "1px solid #0002",
          background: `oklch(var(${varName}))`,
        }}
      />
      <code>{varName}</code>
      <span style={{ opacity: 0.6 }}>{label}</span>
    </div>
  );
}

export const Tokens = () => (
  <div style={{ display: "grid", gap: 6, padding: 16 }}>
    <h3 style={{ fontFamily: "system-ui" }}>Semantic roles (react to the Brand control)</h3>
    {SEMANTIC.map((r) => (
      <Swatch key={r} label="" varName={`--${r}`} />
    ))}
    <h3 style={{ fontFamily: "system-ui", marginTop: 16 }}>Brand ramp</h3>
    <div style={{ display: "flex" }}>
      {RAMP_STOPS.map((stop) => (
        <span
          key={stop}
          title={`--brand-${stop}`}
          style={{ width: 48, height: 40, background: `oklch(var(--brand-${stop}))` }}
        />
      ))}
    </div>
  </div>
);
Tokens.storyName = "Tokens";
