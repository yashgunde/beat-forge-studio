import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFile, readdir, mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

const execFileAsync = promisify(execFile);

export const maxDuration = 300; // 5 minutes

const YOUTUBE_HOSTS = new Set([
  'www.youtube.com',
  'youtube.com',
  'youtu.be',
  'm.youtube.com',
  'music.youtube.com',
]);

function isValidYouTubeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return YOUTUBE_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const { url, title } = await request.json();

  if (!url || !isValidYouTubeUrl(url)) {
    return NextResponse.json({ error: 'Invalid YouTube URL' }, { status: 400 });
  }

  let tempDir: string | null = null;

  try {
    tempDir = await mkdtemp(join(tmpdir(), 'yt-dlp-'));
    const id = randomUUID();
    const outputTemplate = join(tempDir, `${id}.%(ext)s`);

    // Ensure Windows system dirs are on PATH — needed when launched from Git Bash,
    // where the inherited PATH is Unix-style and child processes can't find ffmpeg.
    const env = {
      ...process.env,
      PATH: [
        process.env.PATH,
        'C:\\Windows\\System32',
        'C:\\Windows',
        'C:\\Program Files\\ffmpeg\\bin',
      ].filter(Boolean).join(';'),
    };

    await execFileAsync('yt-dlp', [
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', '0',
      '--no-playlist',
      '--no-warnings',
      '-o', outputTemplate,
      url,
    ], { timeout: 300000, maxBuffer: 10 * 1024 * 1024, env });

    const files = await readdir(tempDir);
    const mp3File = files.find(f => f.startsWith(id) && f.endsWith('.mp3'));

    if (!mp3File) {
      throw new Error('Conversion produced no MP3 file. Is ffmpeg installed?');
    }

    const filePath = join(tempDir, mp3File);
    const fileBuffer = await readFile(filePath);
    const fileName = title
      ? `${String(title).replace(/[<>:"/\\|?*]/g, '_')}.mp3`
      : `${id}.mp3`;

    // Clean up temp dir (fire-and-forget)
    rm(tempDir, { recursive: true }).catch(() => {});

    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
        'Content-Length': fileBuffer.length.toString(),
      },
    });
  } catch (error: unknown) {
    if (tempDir) {
      rm(tempDir, { recursive: true }).catch(() => {});
    }

    const err = error as { code?: string; stderr?: string; message?: string };
    if (err.code === 'ENOENT') {
      return NextResponse.json(
        { error: 'yt-dlp is not installed. Install from: https://github.com/yt-dlp/yt-dlp#installation' },
        { status: 500 },
      );
    }

    return NextResponse.json(
      { error: err.stderr?.trim() || err.message || 'Download failed' },
      { status: 500 },
    );
  }
}
