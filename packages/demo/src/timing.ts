export interface Cue { start: number; end: number; text: string }

/** How long a caption should stay up so it can be read: about 150 words per minute, never under 1.8 s. */
export const captionMs = (text: string, wpm = 150) => Math.max(1800, Math.round((text.trim().split(/\s+/).length / (wpm / 60)) * 1000) + 350);

const pad = (n: number, w = 2) => String(Math.floor(n)).padStart(w, '0');
const ts = (ms: number, sep: string) => `${pad(ms / 3_600_000)}:${pad((ms % 3_600_000) / 60_000)}:${pad((ms % 60_000) / 1000)}${sep}${pad(ms % 1000, 3)}`;
export const toVtt = (cues: Cue[]) => 'WEBVTT\n\n' + cues.map(c => `${ts(c.start, '.')} --> ${ts(c.end, '.')}\n${c.text}\n`).join('\n');
export const toSrt = (cues: Cue[]) => cues.map((c, i) => `${i + 1}\n${ts(c.start, ',')} --> ${ts(c.end, ',')}\n${c.text}\n`).join('\n');
