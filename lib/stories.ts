import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";

export interface StoryMeta {
  slug: string;
  title: string;
  summary: string;
  publishedAt: string;
  updatedAt: string;
}

export interface Story extends StoryMeta {
  content: string;
}

interface ParsedStory extends Story {
  draft: boolean;
  fileName: string;
}

const storiesDirectory = join(process.cwd(), "stories");
const storySlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

class InvalidStoryError extends Error {}

function getErrorCode(error: unknown): string | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }

  return undefined;
}

function logInvalidStory(fileName: string, error: unknown) {
  const code = getErrorCode(error);
  const reason =
    error instanceof InvalidStoryError
      ? error.message
      : `无法读取或解析文档${code ? ` (${code})` : ""}`;

  console.error(`[stories] 跳过无效文档 ${fileName}: ${reason}`);
}

export function logStoriesError(context: string, error: unknown) {
  const code = getErrorCode(error);
  console.error(`[stories] ${context}${code ? ` (${code})` : ""}`);
}

export function isValidStorySlug(slug: string): boolean {
  return storySlugPattern.test(slug);
}

function requireString(data: Record<string, unknown>, field: string): string {
  const value = data[field];

  if (typeof value !== "string") {
    throw new InvalidStoryError(`字段 ${field} 必须是字符串`);
  }

  return value;
}

function normalizeDate(value: unknown, field: string): string {
  if (!(value instanceof Date) && typeof value !== "string") {
    throw new InvalidStoryError(`字段 ${field} 必须是有效日期`);
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new InvalidStoryError(`字段 ${field} 必须是有效日期`);
  }

  return date.toISOString();
}

function removeFrontmatterSeparator(content: string): string {
  if (content.startsWith("\r\n")) {
    return content.slice(2);
  }

  if (content.startsWith("\n")) {
    return content.slice(1);
  }

  return content;
}

function parseStory(source: string, fileName: string): ParsedStory {
  let parsed: matter.GrayMatterFile<string>;

  try {
    parsed = matter(source);
  } catch {
    throw new InvalidStoryError("YAML frontmatter 无法解析");
  }

  const data = parsed.data as Record<string, unknown>;
  const slug = requireString(data, "slug");
  const title = requireString(data, "title").trim();

  if (!isValidStorySlug(slug)) {
    throw new InvalidStoryError("字段 slug 格式无效");
  }

  if (!title) {
    throw new InvalidStoryError("字段 title 不能为空");
  }

  const summaryValue = data.summary;
  if (summaryValue !== undefined && typeof summaryValue !== "string") {
    throw new InvalidStoryError("字段 summary 必须是字符串");
  }

  const publishedAt = normalizeDate(data.publishedAt, "publishedAt");
  const updatedAt =
    data.updatedAt === undefined
      ? publishedAt
      : normalizeDate(data.updatedAt, "updatedAt");

  return {
    slug,
    title,
    summary: summaryValue ?? "",
    publishedAt,
    updatedAt,
    content: removeFrontmatterSeparator(parsed.content),
    draft: data.draft === true,
    fileName,
  };
}

async function readStory(fileName: string): Promise<ParsedStory | null> {
  const filePath = join(storiesDirectory, fileName);
  let file;

  try {
    file = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stats = await file.stat();

    if (!stats.isFile()) {
      throw new InvalidStoryError("不是普通文件");
    }

    const source = await file.readFile({ encoding: "utf8" });
    return parseStory(source, fileName);
  } catch (error) {
    logInvalidStory(fileName, error);
    return null;
  } finally {
    await file?.close();
  }
}

async function scanStories(): Promise<ParsedStory[]> {
  try {
    const directoryStats = await lstat(storiesDirectory);
    if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
      throw new Error("Stories path is not a regular directory");
    }
  } catch (error) {
    if (getErrorCode(error) === "ENOENT") {
      return [];
    }

    throw error;
  }

  let entries;
  try {
    entries = await readdir(storiesDirectory, { withFileTypes: true });
  } catch (error) {
    if (getErrorCode(error) === "ENOENT") {
      return [];
    }

    throw error;
  }

  const fileNames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort();
  const parsedStories = (await Promise.all(fileNames.map(readStory))).filter(
    (story): story is ParsedStory => story !== null,
  );
  const filesBySlug = new Map<string, string[]>();

  for (const story of parsedStories) {
    const fileNamesForSlug = filesBySlug.get(story.slug) ?? [];
    fileNamesForSlug.push(story.fileName);
    filesBySlug.set(story.slug, fileNamesForSlug);
  }

  const duplicateSlugs = new Set<string>();
  for (const [slug, duplicateFiles] of filesBySlug) {
    if (duplicateFiles.length > 1) {
      duplicateSlugs.add(slug);
      console.error(
        `[stories] 重复 slug "${slug}"，已忽略文档: ${duplicateFiles.join(", ")}`,
      );
    }
  }

  return parsedStories.filter((story) => !duplicateSlugs.has(story.slug));
}

function toStoryMeta(story: ParsedStory): StoryMeta {
  return {
    slug: story.slug,
    title: story.title,
    summary: story.summary,
    publishedAt: story.publishedAt,
    updatedAt: story.updatedAt,
  };
}

export async function getPublishedStories(): Promise<StoryMeta[]> {
  const stories = await scanStories();

  return stories
    .filter((story) => !story.draft)
    .sort(
      (first, second) =>
        Date.parse(second.publishedAt) - Date.parse(first.publishedAt) ||
        first.slug.localeCompare(second.slug),
    )
    .map(toStoryMeta);
}

export async function getPublishedStory(slug: string): Promise<Story | null> {
  // Next.js route params are URL-decoded; rejecting any remaining invalid character
  // also blocks encoded traversal and double-encoding attempts.
  if (!isValidStorySlug(slug)) {
    return null;
  }

  const stories = await scanStories();
  const story = stories.find((candidate) => candidate.slug === slug && !candidate.draft);

  if (!story) {
    return null;
  }

  return {
    ...toStoryMeta(story),
    content: story.content,
  };
}
