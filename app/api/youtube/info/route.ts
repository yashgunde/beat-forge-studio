import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

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

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');

  if (!url || !isValidYouTubeUrl(url)) {
    return NextResponse.json({ error: 'Invalid YouTube URL' }, { status: 400 });
  }

  try {
    const { stdout } = await execFileAsync('yt-dlp', [
      '--dump-json',
      '--no-playlist',
      '--no-warnings',
      url,
    ], { timeout: 30000, maxBuffer: 10 * 1024 * 1024 });

    const info = JSON.parse(stdout);

    return NextResponse.json({
      title: info.title,
      duration: info.duration,
      thumbnail: info.thumbnail,
      uploader: info.uploader,
    });
  } catch (error: unknown) {
    const err = error as { code?: string; stderr?: string; message?: string };
    if (err.code === 'ENOENT') {
      return NextResponse.json(
        { error: 'yt-dlp is not installed. Install from: https://github.com/yt-dlp/yt-dlp#installation' },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: err.stderr?.trim() || err.message || 'Failed to fetch video info' },
      { status: 500 },
    );
  }
}
