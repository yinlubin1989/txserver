import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "霓虹乒乓对打",
  description: "联网双人乒乓球小游戏",
};

export default function NeonPingPongPage() {
  return (
    <main className="min-h-screen bg-[#03060d]">
      <iframe
        src="/neon-ping-pong/index.html"
        title="霓虹乒乓对打"
        className="block h-screen w-full border-0"
        allow="fullscreen; gamepad"
        allowFullScreen
      />
    </main>
  );
}
