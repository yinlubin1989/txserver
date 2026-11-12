import { spawn } from 'node:child_process';
import path from 'node:path';

const issue = code => Object.assign(new Error(code), { code });

/** Text goes to stdin, MP3 stays in memory, and provider diagnostics never enter application logs. */
export async function synthesizeNewsSpeech(text, { binary = process.env.WECHAT_NEWS_TTS_BIN,
  voice = process.env.WECHAT_NEWS_TTS_VOICE || 'zh-CN-XiaoxiaoNeural', signal,
  timeoutMs = 35000, spawnImpl = spawn } = {}) {
  if (typeof text !== 'string' || !text.trim() || Array.from(text).length > 160) throw issue('NEWS_SPEECH_INPUT_INVALID');
  if (typeof binary !== 'string' || !path.isAbsolute(binary)) throw issue('NEWS_TTS_NOT_CONFIGURED');
  if (!/^[A-Za-z0-9-]{1,100}$/u.test(voice)) throw issue('NEWS_TTS_NOT_CONFIGURED');
  if (signal?.aborted) throw issue('NEWS_CANCELLED');
  return new Promise((resolve, reject) => {
    const chunks = []; let bytes = 0, failure = null, settled = false, child;
    let timer;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(value);
    };
    const stop = code => { failure ??= issue(code); child?.kill('SIGKILL'); };
    const abort = () => stop('NEWS_CANCELLED');
    try {
      child = spawnImpl(binary, ['--file', '-', '--voice', voice, '--write-media', '-'], {
        shell: false, stdio: ['pipe', 'pipe', 'ignore'],
        env: { PATH: process.env.PATH, LANG: 'C.UTF-8' },
      });
    } catch { finish(issue('NEWS_TTS_NOT_CONFIGURED')); return; }
    timer = setTimeout(() => stop('NEWS_TTS_TIMEOUT'), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    child.on('error', () => finish(issue('NEWS_TTS_NOT_CONFIGURED')));
    child.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 2 * 1024 * 1024) { stop('NEWS_AUDIO_TOO_LARGE'); return; }
      chunks.push(chunk);
    });
    child.stdin.on('error', () => stop('NEWS_TTS_FAILED'));
    child.on('close', code => {
      if (failure) { finish(failure); return; }
      const buffer = Buffer.concat(chunks);
      const isMp3 = buffer.length > 100 && (buffer.subarray(0, 3).toString('ascii') === 'ID3' ||
        (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0));
      if (code !== 0 || !isMp3) { finish(issue('NEWS_TTS_FAILED')); return; }
      finish(null, buffer);
    });
    if (signal?.aborted) abort();
    child.stdin.end(text);
  });
}
