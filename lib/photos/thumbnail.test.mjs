import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { NextRequest } from "next/server.js";
import sharp from "sharp";
import { loadModule } from "../financeStatistics/testLoader.mjs";

async function fixture(t, sharpImpl = sharp) {
  const root = await mkdtemp(join(tmpdir(), "photo-thumbnails-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = process.cwd();
  let storage;
  try {
    process.chdir(root);
    storage = loadModule("../photos/storage.ts");
  } finally { process.chdir(cwd); }
  const thumbnail = loadModule("../photos/thumbnail.ts", { "./storage": storage, sharp: { default: sharpImpl } });
  const route = loadModule("../../app/api/photos/thumbnail/route.ts", { "@/lib/photos/thumbnail": thumbnail });
  const originals = loadModule("../../app/api/photos/route.ts", {
    "@/lib/photos/storage": storage, "@/lib/photos/thumbnail": thumbnail,
  });
  const cache = join(root, ".local-uploads", "photo-thumbnails");
  await mkdir(storage.photoDir, { recursive: true });
  const get = (name, options) => route.GET(new Request("http://test/api/photos/thumbnail?file=" + encodeURIComponent(name) + "&v=123", options));
  return { ...storage, get, cache, originals };
}

const raster = (width, height, background) => sharp({ create: { width, height, channels: 3, background } });

test("existing photo produces one static, display-oriented WebP on concurrent requests", async t => {
  const { photoDir, get, cache } = await fixture(t);
  const name = "旅行 + #1.JPEG";
  const original = await raster(1200, 600, "#fedcba").jpeg().withMetadata({ orientation: 6 }).toBuffer();
  await writeFile(join(photoDir, name), original);
  const responses = await Promise.all(Array.from({ length: 8 }, () => get(name)));
  const tag = responses[0].headers.get("etag");
  const images = await Promise.all(responses.map(async response => {
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/webp");
    assert.equal(response.headers.get("etag"), tag);
    return Buffer.from(await response.arrayBuffer());
  }));
  for (const image of images) assert.deepEqual(image, images[0]);
  const info = await sharp(images[0]).metadata();
  assert.deepEqual([info.format, info.width, info.height], ["webp", 320, 640]);
  assert.ok(images[0].length < original.length);
  const directories = await readdir(cache);
  assert.equal(directories.length, 1);
  const files = await readdir(join(cache, directories[0]));
  assert.equal(files.length, 1);
  assert.deepEqual(await readFile(join(cache, directories[0], files[0])), images[0]);
  assert.equal((await get(name, { headers: { "If-None-Match": tag } })).status, 304);

  await writeFile(join(photoDir, name), await raster(30, 20, "red").png().toBuffer());
  const updated = await get(name, { headers: { "If-None-Match": tag } });
  assert.equal(updated.status, 200);
  assert.notEqual(updated.headers.get("etag"), tag);
  const size = await sharp(Buffer.from(await updated.arrayBuffer())).metadata();
  assert.deepEqual([size.width, size.height], [30, 20]);
});

test("new uploads appear in the original list, retain both GIF frames and produce a first-frame thumbnail", async t => {
  const { get, originals, cache } = await fixture(t);
  const pixels = Buffer.concat([Buffer.from([255, 0, 0]), Buffer.from([0, 0, 255])]);
  const animation = await sharp(pixels, { raw: { channels: 3, width: 1, height: 2, pageHeight: 1 } }).gif({ delay: [120, 120] }).toBuffer();
  assert.equal((await sharp(animation, { animated: true }).metadata()).pages, 2);
  const form = new FormData();
  form.set("image", new File([animation], "test.gif", { type: "image/gif" }));
  const uploaded = await originals.POST(new Request("http://test/api/photos", { method: "POST", body: form }));
  assert.equal(uploaded.status, 201);
  const { filename } = await uploaded.json();
  const listing = await (await originals.GET(new NextRequest("http://test/api/photos"))).json();
  assert.deepEqual(listing.photos.map(file => file.name), [filename]);
  assert.ok(Number.isSafeInteger(listing.photos[0].mtime));
  const url = "http://test/api/photos?file=" + encodeURIComponent(filename);
  const head = await originals.HEAD(new NextRequest(url, { method: "HEAD" }));
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), String(animation.length));
  assert.equal(head.body, null);
  const original = await originals.GET(new NextRequest(url));
  assert.deepEqual(Buffer.from(await original.arrayBuffer()), animation);
  const preview = await get(filename);
  assert.equal(preview.status, 200);
  const tag = preview.headers.get("etag");
  const image = sharp(Buffer.from(await preview.arrayBuffer()));
  assert.equal((await image.metadata()).pages ?? 1, 1);
  const [red, , blue] = await image.raw().toBuffer();
  assert.ok(red > blue);
  const del = () => originals.DELETE(new NextRequest(url, { method: "DELETE", body: JSON.stringify({ password: "123" }) }));
  assert.equal((await del()).status, 200);
  assert.equal((await get(filename, { headers: { "If-None-Match": tag } })).status, 404);
  assert.deepEqual(await readdir(cache), []);
  assert.equal((await del()).status, 500);
});

test("nonphotos and symbolic links cannot be served; an invalid photo can be repaired and retried", async t => {
  const { get, photoDir } = await fixture(t);
  const valid = await raster(2, 2, "blue").png().toBuffer();
  await writeFile(join(photoDir, "note.txt"), valid);
  await symlink(join(photoDir, "note.txt"), join(photoDir, "link.png"));
  assert.equal((await get("note.txt")).status, 400);
  assert.equal((await get(".hidden.jpg")).status, 400);
  assert.equal((await get("folder/pic.jpg")).status, 400);
  assert.equal((await get("link.png")).status, 404);
  await writeFile(join(photoDir, "bad.png"), "incomplete");
  assert.equal((await get("bad.png")).status, 415);
  await writeFile(join(photoDir, "bad.png"), valid);
  assert.equal((await get("bad.png")).status, 200);
});

test("cold requests for different photos use at most two native encoders", async t => {
  let active = 0, peak = 0;
  const controlledSharp = (input, options) => {
    if (process.platform === "darwin" || process.platform === "linux") assert.equal(typeof input, "string");
    const pipeline = sharp(input, options);
    const convert = pipeline.toBuffer.bind(pipeline);
    pipeline.toBuffer = async () => {
      active++;
      peak = Math.max(peak, active);
      try {
        await new Promise(resolve => setTimeout(resolve, 25));
        return await convert();
      } finally { active--; }
    };
    return pipeline;
  };
  const { photoDir, get } = await fixture(t, controlledSharp);
  const names = Array.from({ length: 8 }, (_, n) => "spring-" + n + ".jpg");
  const source = await raster(3000, 2000, "green").jpeg().toBuffer();
  await Promise.all(names.map(name => writeFile(join(photoDir, name), source)));
  const results = await Promise.all(names.map(name => get(name)));
  assert.ok(results.every(result => result.status === 200));
  assert.equal(peak, 2);
});

test("deletion during encoding cannot resurrect the file's cache directory", async t => {
  const started = Promise.withResolvers(), release = Promise.withResolvers();
  const pausedSharp = (input, options) => {
    const pipeline = sharp(input, options);
    const convert = pipeline.toBuffer.bind(pipeline);
    pipeline.toBuffer = async () => {
      const bytes = await convert();
      started.resolve();
      await release.promise;
      return bytes;
    };
    return pipeline;
  };
  const { photoDir, get, originals, cache } = await fixture(t, pausedSharp);
  await writeFile(join(photoDir, "autumn.png"), await raster(200, 200, "yellow").png().toBuffer());
  const loading = get("autumn.png");
  await started.promise;
  try {
    const deleted = await originals.DELETE(new NextRequest("http://test/api/photos?file=autumn.png", {
      method: "DELETE", body: JSON.stringify({ password: "123" }),
    }));
    assert.equal(deleted.status, 200);
  } finally { release.resolve(); }
  assert.equal((await loading).status, 404);
  assert.deepEqual(await readdir(cache), []);
});
