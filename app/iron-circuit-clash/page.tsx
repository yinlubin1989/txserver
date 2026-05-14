import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "钢铁电路对决",
  description: "街机联机格斗小游戏",
};

export default function IronCircuitClashPage() {
  return (
    <main className="min-h-screen bg-[#080705]">
      <iframe
        src="/iron-circuit-clash/index.html"
        title="钢铁电路对决"
        className="block h-screen w-full border-0"
        allow="fullscreen; gamepad"
        allowFullScreen
      />
    </main>
  );
}
