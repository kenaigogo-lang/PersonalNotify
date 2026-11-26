import { env, handle, json } from './_lib/auth.js';

export const GET = handle(async () => {
  return json({
    ok: true,
    service: 'PersonalNotify',
    env: {
      firebaseProjectId: Boolean(env('FIREBASE_PROJECT_ID')),
      lineChannelAccessToken: Boolean(env('LINE_CHANNEL_ACCESS_TOKEN')),
      lineUserId: Boolean(env('LINE_USER_ID')),
      igdbConfigured: Boolean(env('IGDB_CLIENT_ID') && env('IGDB_CLIENT_SECRET')),
    },
  });
});
