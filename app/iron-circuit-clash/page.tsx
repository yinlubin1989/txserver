import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Iron Circuit Clash",
  description: "街机格斗小游戏",
};

export default function IronCircuitClashPage() {
  return (
    <main className="min-h-screen bg-[#080705]">
      <iframe
        src="/iron-circuit-clash/index.html"
        title="Iron Circuit Clash"
        className="block h-screen w-full border-0"
        allow="fullscreen; gamepad"
        allowFullScreen
      />
    </main>
  );
}
