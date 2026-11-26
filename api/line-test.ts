import { env, handle, json, requireUser } from './_lib/auth.js';
import { pushLineMessages } from './_lib/line.js';
import { buildTestFlexMessage } from '../shared/line-flex.js';

export const POST = handle(async (request) => {
  await requireUser(request);

  const body = (await request.json().catch(() => ({}))) as { lineUserId?: string };
  const targetUserId = body.lineUserId || env('LINE_USER_ID') || '';
  const appBaseUrl = env('APP_BASE_URL') || request.headers.get('origin') || undefined;

  const flex = buildTestFlexMessage(appBaseUrl);
  await pushLineMessages(targetUserId, [flex]);

  return json({ ok: true, sentAt: Date.now() });
});
