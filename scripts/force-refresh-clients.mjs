#!/usr/bin/env node
import { initializeApp } from '../functions/media_processing/node_modules/firebase-admin/lib/app/index.js';
import { getFirestore } from '../functions/media_processing/node_modules/firebase-admin/lib/firestore/index.js';

const ENV_PROJECT_MAP = {
  dev: 'it114115-dev-2026',
  prod: 'it114115-2627',
};

const args = process.argv.slice(2);
const envArg = args.find((a) => a.startsWith('--env='));
const projectArg = args.find((a) => a.startsWith('--project='));
const modeArg = args.find((a) => a.startsWith('--mode='));
const msgArg = args.find((a) => a.startsWith('--message='));
const useNow = args.includes('--now');
const clearFlag = args.includes('--clear');
const unknownFlags = args.filter(
  (a) =>
    a.startsWith('--') &&
    !a.startsWith('--env=') &&
    !a.startsWith('--project=') &&
    !a.startsWith('--mode=') &&
    !a.startsWith('--message=') &&
    a !== '--now' &&
    a !== '--clear'
);

if (unknownFlags.length > 0) {
  console.error(
    `❌ Unknown flag(s): ${unknownFlags.join(', ')}. Supported: --env=dev|prod, --project=<id>, --mode=prompt|force_idle|force_now, --message="<text>", --now, --clear`
  );
  process.exit(1);
}

const positionalProject = args.find((a) => !a.startsWith('--'));
const rawEnv = envArg ? envArg.slice('--env='.length).trim() : null;
if (rawEnv && !ENV_PROJECT_MAP[rawEnv]) {
  console.error(`❌ Invalid --env="${rawEnv}". Use --env=dev or --env=prod`);
  process.exit(1);
}

const rawTarget = projectArg
  ? projectArg.slice('--project='.length).trim()
  : rawEnv || positionalProject || 'it114115-2627';
const projectId = ENV_PROJECT_MAP[rawTarget] || rawTarget;
const mode = modeArg ? modeArg.split('=')[1] : 'force_idle';
const validModes = ['prompt', 'force_idle', 'force_now'];

if (!validModes.includes(mode)) {
  console.error(`❌ Invalid mode "${mode}". Use --mode=prompt|force_idle|force_now`);
  process.exit(1);
}

const message = msgArg ? msgArg.slice('--message='.length).trim() : null;

async function resolveForceReloadBefore() {
  if (useNow) {
    return { ts: Date.now(), source: '--now' };
  }
  const versionUrl = `https://${projectId}.web.app/version.json?t=${Date.now()}`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(versionUrl, { cache: 'no-store', signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      const ts = Number(data?.buildTimestamp);
      if (Number.isFinite(ts) && ts > 0) {
        return { ts, source: versionUrl };
      }
    }
  } catch {
    // Fallback to Date.now() if version.json is unavailable on older builds
  }
  return { ts: Date.now(), source: 'fallback-Date.now()' };
}

initializeApp({ projectId });
const db = getFirestore();

if (clearFlag) {
  await db.doc('system_config/clientControl').delete();
  console.log(`✅ Cleared system_config/clientControl on ${projectId}`);
  process.exit(0);
}

const { ts: forceReloadBefore, source } = await resolveForceReloadBefore();

await db.doc('system_config/clientControl').set(
  {
    forceReloadBefore,
    mode,
    message: message || null,
    triggeredBy: 'cli-admin',
    updatedAt: new Date(forceReloadBefore).toISOString(),
  },
  { merge: true }
);

console.log(`✅ Updated system_config/clientControl on ${projectId}: mode=${mode}, forceReloadBefore=${forceReloadBefore} (${new Date(forceReloadBefore).toISOString()}) [source: ${source}]`);
process.exit(0);
