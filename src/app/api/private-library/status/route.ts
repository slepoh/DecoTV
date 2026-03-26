import { NextResponse } from 'next/server';

import { hasEnabledPrivateLibraryConnector } from '@/lib/private-library';

export const runtime = 'nodejs';

export async function GET() {
  const enabled = await hasEnabledPrivateLibraryConnector();
  return NextResponse.json({ enabled });
}
