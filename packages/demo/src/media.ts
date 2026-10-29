import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { promisify } from 'node:util';
const run = promisify(execFile);

export async function hasFfmpeg(): Promise<boolean> { try { await run('ffmpeg', ['-version']); return true; } catch { return false; } }
const ff = (args: string[]) => run('ffmpeg', ['-y', '-loglevel', 'error', ...args], { maxBuffer: 20 * 1024 * 1024 });

export interface AudioClip { path: string; startMs: number }
export interface TtsProvider { synthesize(text: string, outPath: string): Promise<{ path: string; durationMs: number }> }

/** Test/offline "voice": silence whose length follows the word count. It exercises narration-first timing and muxing without pretending to speak. */
export class SilentTts implements TtsProvider {
  constructor(private msPerWord = 380) {}
  async synthesize(text: string, outPath: string) {
    const durationMs = Math.max(1200, text.trim().split(/\s+/).length * this.msPerWord);
    await ff(['-f', 'lavfi', '-i', 'anullsrc=r=22050:cl=mono', '-t', (durationMs / 1000).toFixed(2), outPath]);
    return { path: outPath, durationMs };
  }
}

/** webm -> mp4. `stage` puts a phone-shaped recording centered on a 1280x720 canvas. Optional narration clips are placed at their start times. */
export async function encodeMp4(webm: string, out: string, o: { clips?: AudioClip[]; stage?: boolean } = {}): Promise<void> {
  const clips = o.clips ?? []; const inputs = ['-i', webm, ...clips.flatMap(c => ['-i', c.path])];
  const vf = o.stage ? 'scale=-2:660,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0x0d1722,format=yuv420p' : 'format=yuv420p';
  const enc = ['-c:v', 'libx264', '-crf', '20', '-preset', 'veryfast', '-movflags', '+faststart'];
  if (!clips.length) { await ff([...inputs, '-vf', vf, ...enc, out]); return; }
  const delays = clips.map((c, i) => `[${i + 1}:a]adelay=${c.startMs}|${c.startMs}[a${i}]`).join(';');
  const mix = clips.map((_, i) => `[a${i}]`).join('') + `amix=inputs=${clips.length}:normalize=0[aout]`;
  await ff([...inputs, '-filter_complex', `${delays};${mix};[0:v]${vf}[v]`, '-map', '[v]', '-map', '[aout]', ...enc, '-c:a', 'aac', '-b:a', '128k', out]);
}

export async function extractFrames(video: string, timesSec: number[], outDir: string): Promise<string[]> {
  fs.mkdirSync(outDir, { recursive: true }); const out: string[] = [];
  for (const t of timesSec) { const p = `${outDir}/frame-${String(Math.round(t * 10)).padStart(4, '0')}.png`; await ff(['-ss', String(t), '-i', video, '-frames:v', '1', p]); if (fs.existsSync(p)) out.push(p); }
  return out;
}
export async function probe(file: string): Promise<{ durationSec: number; hasAudio: boolean; hasVideo: boolean; width: number; height: number }> {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', file]);
  const j = JSON.parse(stdout) as { streams: { codec_type: string; width?: number; height?: number }[]; format: { duration: string } };
  const v = j.streams.find(s => s.codec_type === 'video');
  return { durationSec: Number(j.format.duration), hasAudio: j.streams.some(s => s.codec_type === 'audio'), hasVideo: !!v, width: v?.width ?? 0, height: v?.height ?? 0 };
}
