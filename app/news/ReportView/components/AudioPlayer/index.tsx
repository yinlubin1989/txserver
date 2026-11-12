"use client";

import { useRef, useState } from "react";
import styles from "./style.module.css";

export function AudioPlayer({ url, transcript }: { url: string; transcript: string | null }) {
  const player = useRef<HTMLAudioElement>(null);
  const [rate, setRate] = useState(1);
  const [hasError, setHasError] = useState(false);
  return <section className={styles.player} aria-labelledby="audio-heading">
    <div className={styles.heading}>
      <h2 id="audio-heading">收听简报<span>AUDIO</span></h2>
      <label className={styles.speed}>倍速<select aria-label="播放速度" value={rate} onChange={event => {
        const next = Number(event.target.value); setRate(next); if (player.current) player.current.playbackRate = next;
      }}>{[1, 1.25, 1.5, 2].map(value => <option key={value} value={value}>{value}×</option>)}</select></label>
    </div>
    <audio ref={player} controls preload="metadata" src={url} aria-label="简报正文朗读"
      onError={() => setHasError(true)} onLoadedMetadata={() => { if (player.current) player.current.playbackRate = rate; }} />
    {hasError && <p className={styles.error} role="alert">音频暂时无法播放。<button type="button" onClick={() => { setHasError(false); player.current?.load(); }}>重试</button></p>}
    {transcript && <details className={styles.transcript}><summary>查看朗读文字</summary><p>{transcript}</p></details>}
  </section>;
}
