import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "原则",
  description: "关于生活状态、社交、付出、自由、沟通、消息回复、守信、家务与休息、金钱、指挥的原则",
};

const principles = [
  {
    label: "关于生活状态",
    text: "不双标。你不回我家，那我也不回你家，否则双方父母都会不高兴。",
  },
  {
    label: "关于社交",
    text: "你的朋友我不喜欢，也聊不到一块去。我本身不爱社交，更不会和没有共同语言的人玩。如果不是必须参与的场合，我是否陪你去玩是我的自由，不要因此不高兴。",
  },
  {
    label: "关于付出",
    text: "相互付出才是健康的关系，而不是单方面付出。如果一方不付出，也请别双标，允许另一方同样不付出。",
  },
  {
    label: "关于自由",
    text: "禁止无理由的夜不归宿、没有边界感等行为。恋爱本来就是会限制自由的，这是共识。",
  },
  {
    label: "关于沟通",
    text: "沟通时不带情绪，要讲道理，不要冷暴力。",
  },
  {
    label: "关于消息回复",
    text: "双方看到消息尽量回复，不要总是一副爱答不理的样子。",
  },
  {
    label: "关于守信",
    text: "凡事要有规划，定好的事要尽量守信，否则会很耽误对方的时间。",
  },
  {
    label: "关于家务与休息",
    text: "双方都不是对方的免费保姆。要多替对方考虑，不要看对方闲着就不舒服。谁都有休息的权利，谁都会累，不可能24小时工作。",
  },
  {
    label: "关于金钱",
    text: `要长远考虑，学会攒钱。不要老说什么“抠门”。花钱要有规划，不该花的钱不乱花。借给别人钱要适度、看情况，借出去的钱就要当作是送出去的，别说什么“借出去就是攒钱”之类的话，那很幼稚。`,
  },
  {
    label: "关于指挥",
    text: "不要总是指挥别人做这做那，自己能干的事就自己干。指挥也可以，但对方拒绝时不能生气。",
  },
];

export default function PrinciplesPage() {
  return (
    <main className="flex min-h-screen flex-col items-center bg-white px-6 py-12 text-black sm:py-20">
      <div className="w-full max-w-2xl">
        <Link
          href="/"
          className="text-xs font-medium uppercase tracking-[0.22em] text-neutral-400 transition-colors duration-200 hover:text-black"
        >
          HOME
        </Link>

        <h1 className="mt-10 text-2xl font-light tracking-[0.08em] sm:text-3xl">
          原则
        </h1>
        <p className="mt-2 text-sm leading-relaxed tracking-wide text-neutral-400">
          关系中的共识与边界
        </p>

        <div className="mt-12 space-y-10">
          {principles.map((p) => (
            <section key={p.label}>
              <h2 className="text-sm font-medium uppercase tracking-[0.15em] text-neutral-400">
                {p.label}
              </h2>
              <p className="mt-2 text-base leading-8 text-neutral-700">
                {p.text}
              </p>
            </section>
          ))}
        </div>

        <div className="mt-16 h-px w-8 bg-neutral-200" />

        <footer className="mt-10 text-center">
          <a
            href="https://beian.miit.gov.cn/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-neutral-300 transition-colors duration-300 hover:text-neutral-500"
          >
            京ICP备2025157289号-2
          </a>
        </footer>
      </div>
    </main>
  );
}