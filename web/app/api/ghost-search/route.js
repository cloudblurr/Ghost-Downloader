import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

const BACKEND_URL = process.env.GHOST_SEARCH_URL || 'http://localhost:8000';

export async function POST(request) {
  try {
    const body = await request.json();

    const resp = await fetch(`${BACKEND_URL}/api/ghost-search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await resp.json();

    if (!resp.ok) {
      return NextResponse.json(
        { error: data.detail || 'Search backend error' },
        { status: resp.status }
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err.message || 'Failed to reach search backend' },
      { status: 502 }
    );
  }
}
