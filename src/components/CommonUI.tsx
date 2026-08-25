import React from "react";
import { CheckCircle2 } from "lucide-react";

export const C = {
  bg: "#FAFAF8",
  card: "#FFFFFF",
  border: "#E6E3DA",
  primary: "#1F6F50",
  primaryDark: "#154D38",
  primaryLight: "#E1F0E8",
  amber: "#C79A2E",
  amberLight: "#FFF8EC",
  red: "#B5342B",
  redLight: "#FDF0EE",
  text: "#2B2B28",
  muted: "#6B6B63",
};

export const FONT_SERIF = "'Georgia','Times New Roman',serif";
export const FONT_SANS = "Arial,'Helvetica Neue',sans-serif";
export const FONT_MONO = "'SFMono-Regular','Menlo','Consolas',monospace";

export function Card({ children, style, id }: { children: React.ReactNode; style?: React.CSSProperties; id?: string }) {
  return (
    <div id={id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "22px 24px", ...style }}>
      {children}
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = "primary",
  disabled,
  icon: Icon,
  style,
  type = "button",
  id,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  disabled?: boolean;
  icon?: any;
  style?: React.CSSProperties;
  type?: "button" | "submit" | "reset";
  id?: string;
}) {
  const base: React.CSSProperties = {
    fontFamily: FONT_SANS,
    fontSize: 13.5,
    fontWeight: 600,
    padding: "9px 16px",
    borderRadius: 7,
    border: "1px solid transparent",
    cursor: disabled ? "not-allowed" : "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    opacity: disabled ? 0.5 : 1,
    transition: "opacity .15s",
  };
  const variants = {
    primary: { background: C.primary, color: "#fff" },
    secondary: { background: "#fff", color: C.primaryDark, border: `1px solid ${C.primary}` },
    ghost: { background: "transparent", color: C.muted },
    danger: { background: "transparent", color: C.red, border: `1px solid ${C.red}55` },
  };
  return (
    <button id={id} type={type} onClick={disabled ? undefined : onClick} disabled={disabled} style={{ ...base, ...variants[variant], ...style }}>
      {Icon && <Icon size={15} />}
      {children}
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: "block", fontFamily: FONT_SANS, fontSize: 12, fontWeight: 700, color: C.primaryDark, textTransform: "uppercase", letterSpacing: ".03em", marginBottom: 6 }}>
        {label}
      </label>
      {children}
      {hint && <div style={{ fontFamily: FONT_SANS, fontSize: 11.5, color: C.muted, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

export const inputStyle: React.CSSProperties = {
  width: "100%",
  fontFamily: FONT_MONO,
  fontSize: 13.5,
  padding: "8px 10px",
  border: `1px solid ${C.border}`,
  borderRadius: 6,
  color: C.text,
  background: "#fff",
};

export function Stepper({ step, maxStep, onJump }: { step: number; maxStep: number; onJump: (n: number) => void }) {
  const steps = ["Dati", "Strategia", "Money Mgmt", "Report", "Monte Carlo", "Scenario", "Walk-Forward"];
  return (
    <div style={{ display: "flex", gap: 0, marginBottom: 30, fontFamily: FONT_SANS }}>
      {steps.map((label, idx) => {
        const n = idx + 1;
        const active = n === step;
        const done = n < step;
        const reachable = n <= maxStep;
        return (
          <div key={label} style={{ display: "flex", alignItems: "center", flex: idx < steps.length - 1 ? 1 : "0 0 auto" }}>
            <div id={`step-tab-${n}`} onClick={() => reachable && onJump(n)} style={{ display: "flex", alignItems: "center", gap: 9, cursor: reachable ? "pointer" : "default" }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 13,
                  fontWeight: 700,
                  flexShrink: 0,
                  background: active ? C.primary : done ? C.primaryLight : "#fff",
                  color: active ? "#fff" : done ? C.primaryDark : C.muted,
                  border: `1.5px solid ${active || done ? C.primary : C.border}`,
                }}
              >
                {done ? <CheckCircle2 size={15} /> : n}
              </div>
              <span style={{ fontSize: 13, fontWeight: active ? 700 : 500, color: active ? C.primaryDark : done ? C.text : C.muted, whiteSpace: "nowrap" }}>
                {label}
              </span>
            </div>
            {idx < steps.length - 1 && <div style={{ flex: 1, height: 1.5, background: n < step ? C.primary : C.border, margin: "0 14px" }} />}
          </div>
        );
      })}
    </div>
  );
}

export function KPI({ label, value, negative, id }: { label: string; value: string | number; negative?: boolean; id?: string }) {
  const displayVal = typeof value === "number" && Number.isNaN(value) ? "—" : value ?? "—";
  return (
    <div id={id} style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 8, padding: "14px 12px", textAlign: "center" }}>
      <div style={{ fontFamily: FONT_SANS, fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".04em", color: C.muted }}>{label}</div>
      <div style={{ fontFamily: FONT_SANS, fontSize: 20, fontWeight: 700, color: negative ? C.red : C.primaryDark, marginTop: 4 }}>{displayVal}</div>
    </div>
  );
}
