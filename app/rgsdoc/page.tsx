import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "RedGreenSign 使用指南",
  description: "RedGreenSign 状态灯安装、连接和常见问题说明",
};

type HeadingLevel = 1 | 2 | 3;

type MarkdownBlock =
  | { type: "heading"; level: HeadingLevel; text: string; id: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "code"; language: string; code: string };

const markdownPath = join(process.cwd(), "public/rgsdoc/USER_GUIDE.md");
const markdown = readFileSync(markdownPath, "utf8");
const blocks = parseMarkdown(markdown);
const title =
  blocks.find(
    (block): block is Extract<MarkdownBlock, { type: "heading" }> =>
      block.type === "heading" && block.level === 1,
  )?.text ?? "RedGreenSign 使用指南";
const articleBlocks = blocks.filter(
  (block) => block.type !== "heading" || block.level !== 1,
);
const toc = articleBlocks.filter(
  (block): block is Extract<MarkdownBlock, { type: "heading" }> =>
    block.type === "heading",
);
const appDownload = {
  href: "/rgsdoc/RedGreenSign-macos.dmg",
  filename: "RedGreenSign-macos.dmg",
  size: "33.1 MB",
  sha256: "40ad20ae6a88b08ac89a5e70c52e380202f292d5274447a293b8cb37995b37ce",
};

export default function RgsDocPage() {
  return (
    <main className="min-h-dvh bg-[#f6f4ef] text-[#171717]">
      <div className="mx-auto flex w-full max-w-7xl gap-10 px-5 py-6 sm:px-8 lg:px-10 lg:py-10">
        <aside className="hidden w-64 shrink-0 xl:block">
          <div className="sticky top-8 border-l border-black/10 pl-5">
            <p className="text-xs font-medium uppercase tracking-[0.24em] text-[#777168]">
              RGS DOC
            </p>
            <nav className="mt-6 flex flex-col gap-3 text-sm leading-5">
              {toc.map((heading) => (
                <a
                  key={heading.id}
                  href={`#${heading.id}`}
                  className={`transition-colors duration-200 hover:text-[#0d6b43] ${
                    heading.level === 3 ? "pl-4 text-[#777168]" : "text-[#2a2926]"
                  }`}
                >
                  {heading.text}
                </a>
              ))}
            </nav>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="border-b border-black/10 pb-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Link
                href="/"
                className="text-xs font-medium uppercase tracking-[0.22em] text-[#777168] transition-colors duration-200 hover:text-black"
              >
                HOME
              </Link>
              <div className="flex flex-wrap gap-2">
                <a
                  href={appDownload.href}
                  download={appDownload.filename}
                  className="border border-[#0d6b43] bg-[#0d6b43] px-4 py-2 text-xs font-medium uppercase tracking-[0.18em] text-white transition-all duration-200 hover:bg-[#095837]"
                >
                  下载 DMG
                </a>
                <a
                  href="/rgsdoc/USER_GUIDE.md"
                  className="border border-black/20 px-4 py-2 text-xs font-medium uppercase tracking-[0.18em] transition-all duration-200 hover:border-black hover:bg-black hover:text-white"
                >
                  Markdown
                </a>
              </div>
            </div>

            <div className="mt-12 max-w-3xl">
              <p className="text-sm font-medium uppercase tracking-[0.22em] text-[#777168]">
                RedGreenSign
              </p>
              <h1 className="mt-4 text-[2.7rem] font-semibold leading-[1.05] tracking-normal text-[#111] sm:text-6xl">
                {title}
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-8 text-[#55514a] sm:text-lg">
                AI 工作状态灯的安装、连接、启动、测试和问题排查说明。
              </p>
            </div>

            <section className="mt-8 max-w-3xl border border-[#0d6b43]/30 bg-white/55 p-5 sm:flex sm:items-center sm:justify-between sm:gap-6">
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-[#0d6b43]">
                  Mac 安装包
                </p>
                <h2 className="mt-2 text-xl font-semibold leading-tight tracking-normal text-[#171717]">
                  RedGreenSign-macos.dmg
                </h2>
                <p className="mt-2 text-sm leading-6 text-[#55514a]">
                  {appDownload.size} · SHA256 {appDownload.sha256.slice(0, 12)}...
                </p>
              </div>
              <a
                href={appDownload.href}
                download={appDownload.filename}
                className="mt-4 inline-flex w-full items-center justify-center border border-[#0d6b43] bg-[#0d6b43] px-5 py-3 text-sm font-medium text-white transition-all duration-200 hover:bg-[#095837] sm:mt-0 sm:w-auto"
              >
                下载 App
              </a>
            </section>

            <div className="mt-8 grid gap-3 sm:grid-cols-4">
              <StatusLight color="#18864f" label="绿灯常亮" value="空闲或完成" />
              <StatusLight color="#c89016" label="黄灯闪烁" value="正在执行" />
              <StatusLight color="#c9413b" label="红灯常亮" value="等待授权" />
              <StatusLight color="#2f3030" label="灯全灭" value="服务停止" />
            </div>
          </header>

          <article className="max-w-3xl py-10 sm:py-12">
            {articleBlocks.map((block, index) => (
              <MarkdownRenderer block={block} key={`${block.type}-${index}`} />
            ))}
          </article>
        </div>
      </div>
    </main>
  );
}

function StatusLight({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 border border-black/10 bg-white/45 px-4 py-3">
      <span
        className="size-3 shrink-0 rounded-full shadow-[0_0_0_4px_rgba(0,0,0,0.04)]"
        style={{ backgroundColor: color }}
      />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-[#1d1c19]">
          {label}
        </span>
        <span className="block truncate text-xs leading-5 text-[#777168]">
          {value}
        </span>
      </span>
    </div>
  );
}

function MarkdownRenderer({ block }: { block: MarkdownBlock }) {
  if (block.type === "heading") {
    const Tag = block.level === 2 ? "h2" : block.level === 3 ? "h3" : "h1";
    const className =
      block.level === 2
        ? "mb-4 mt-11 scroll-mt-8 border-t border-black/10 pt-8 text-2xl font-semibold leading-tight tracking-normal text-[#111] first:mt-0 first:border-t-0 first:pt-0"
        : block.level === 3
          ? "mb-3 mt-7 scroll-mt-8 text-lg font-semibold leading-tight tracking-normal text-[#2a2926]"
          : "mb-5 scroll-mt-8 text-4xl font-semibold leading-tight tracking-normal text-[#111]";

    return (
      <Tag className={className} id={block.id}>
        {block.text}
      </Tag>
    );
  }

  if (block.type === "paragraph") {
    return (
      <p className="mb-5 text-[1.03rem] leading-8 text-[#403d38]">
        {renderInline(block.text)}
      </p>
    );
  }

  if (block.type === "list") {
    const ListTag = block.ordered ? "ol" : "ul";
    return (
      <ListTag className="mb-6 ml-5 space-y-2 text-[1.03rem] leading-8 text-[#403d38] marker:text-[#0d6b43]">
        {block.items.map((item) => (
          <li className={block.ordered ? "list-decimal pl-1" : "list-disc pl-1"} key={item}>
            {renderInline(item)}
          </li>
        ))}
      </ListTag>
    );
  }

  return (
    <pre className="mb-7 overflow-x-auto border border-black/10 bg-[#1f211f] p-5 text-sm leading-7 text-[#f7f2df]">
      <code>{block.code}</code>
    </pre>
  );
}

function renderInline(text: string) {
  return text.split(/(`[^`]+`)/g).filter(Boolean).map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          className="mx-0.5 bg-[#e7e2d5] px-1.5 py-0.5 text-[0.94em] text-[#171717]"
          key={`${part}-${index}`}
        >
          {part.slice(1, -1)}
        </code>
      );
    }

    return <span key={`${part}-${index}`}>{part}</span>;
  });
}

function parseMarkdown(source: string): MarkdownBlock[] {
  const parsed: MarkdownBlock[] = [];
  const paragraph: string[] = [];
  let list: Extract<MarkdownBlock, { type: "list" }> | null = null;
  let code: { language: string; lines: string[] } | null = null;
  let headingIndex = 0;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    parsed.push({ type: "paragraph", text: paragraph.join(" ") });
    paragraph.length = 0;
  };

  const flushList = () => {
    if (!list) return;
    parsed.push(list);
    list = null;
  };

  const flushText = () => {
    flushParagraph();
    flushList();
  };

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trimEnd();

    if (code) {
      if (line.startsWith("```")) {
        parsed.push({
          type: "code",
          language: code.language,
          code: code.lines.join("\n"),
        });
        code = null;
      } else {
        code.lines.push(rawLine);
      }
      continue;
    }

    const fence = line.match(/^```(\w+)?/);
    if (fence) {
      flushText();
      code = { language: fence[1] ?? "", lines: [] };
      continue;
    }

    if (!line.trim()) {
      flushText();
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushText();
      headingIndex += 1;
      parsed.push({
        type: "heading",
        level: heading[1].length as HeadingLevel,
        text: heading[2],
        id: `section-${headingIndex}`,
      });
      continue;
    }

    const unordered = line.match(/^-\s+(.+)$/);
    const ordered = line.match(/^\d+\.\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph();
      const isOrdered = Boolean(ordered);
      if (!list || list.ordered !== isOrdered) {
        flushList();
        list = { type: "list", ordered: isOrdered, items: [] };
      }
      list.items.push((unordered ?? ordered)?.[1] ?? "");
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }

  if (code) {
    parsed.push({
      type: "code",
      language: code.language,
      code: code.lines.join("\n"),
    });
  }
  flushText();

  return parsed;
}
