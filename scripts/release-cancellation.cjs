'use strict';
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const project = '42ebb6eb-62b1-4784-a483-831ae3c804f2';
const sha = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
function eas(args) {
  const result = spawnSync('eas', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) {
    let diagnostic = result.stderr || '';
    for (const value of Object.values(process.env)) if (value && value.length > 8) diagnostic = diagnostic.split(value).join('[masked]');
    diagnostic = diagnostic.replace(/eyJ[A-Za-z0-9_.-]+|(?:sk|sb_secret|ExpoToken)_[A-Za-z0-9_-]+/g, '[masked]');
    console.error(diagnostic.slice(-6000));
    throw Error('EAS ' + args[0] + ' failed; inspect existing IDs before retrying');
  }
  return result.stdout;
}
async function query(query, variables) {
  const response = await fetch('https://api.expo.dev/graphql', {
    method: 'POST', headers: { 'Content-Type': 'application/json', authorization: 'Bearer ' + process.env.EXPO_TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  const body = await response.json();
  if (!response.ok || body.errors?.length) throw Error('EAS metadata request failed');
  return body.data;
}
async function snapshot() {
  const data = await query('query($id:String!){app{byId(appId:$id){id builds(offset:0,limit:50){id status platform buildProfile appVersion appBuildVersion gitCommitHash artifacts{applicationArchiveUrl} submissions{id status iosConfig{ascAppIdentifier}}}}}}', { id: project });
  if (data.app.byId.id !== project) throw Error('Wrong Expo project');
  return data.app.byId.builds;
}
function candidate(builds, platform, profile) {
  const found = builds.filter(b => b.gitCommitHash === sha && b.platform === platform && b.buildProfile === profile);
  if (found.length > 1) throw Error('Duplicate builds require inspection');
  const build = found[0];
  if (build && ['ERRORED', 'CANCELED'].includes(build.status)) throw Error('Failed build ' + build.id);
  return build;
}
function receipt(build) {
  return { id: build.id, platform: build.platform, status: build.status, profile: build.buildProfile, version: build.appVersion, buildNumber: build.appBuildVersion, source: build.gitCommitHash, url: build.artifacts?.applicationArchiveUrl, submissions: build.submissions };
}
(async () => {
  fs.mkdirSync('build-receipts', { recursive: true });
  fs.writeFileSync('build-receipts/source.txt', sha);
  eas(['env:pull', '--environment', 'preview', '--path', '.env.local', '--non-interactive']);
  const vars = require('dotenv').parse(fs.readFileSync('.env.local'));
  for (const [name, value] of Object.entries(vars)) if (name.startsWith('EXPO_PUBLIC_')) process.env[name] = value;
  process.env.ECLIPSE_BUILD_ENV = 'staging';
  require('./buildEnvironment.cjs').validateBuildEnvironment();
  const config = require('../eas.json');
  if (config.build.preview.android.buildType !== 'apk' || config.build.preview.environment !== 'preview' || config.build.testflight.extends !== 'preview' || config.submit.testflight.ios.ascAppId !== '6773071994') throw Error('Unexpected release profiles');
  let builds = await snapshot();
  for (const [platform, profile] of [['IOS', 'testflight'], ['ANDROID', 'preview']]) {
    let build = candidate(builds, platform, profile);
    if (!build) {
      const args = ['build', '--platform', platform.toLowerCase(), '--profile', profile, '--message', 'Cancellation keyboard, profile history and navigation fixes', '--non-interactive', '--no-wait', '--json'];
      if (platform === 'IOS') args.push('--auto-submit-with-profile', 'testflight');
      const raw = JSON.parse(eas(args));
      const id = (Array.isArray(raw) ? raw[0] : raw)?.id;
      builds = await snapshot();
      build = candidate(builds, platform, profile);
      if (!id || build?.id !== id) throw Error('Build creation requires inspection');
    }
    fs.writeFileSync('build-receipts/' + platform + '.json', JSON.stringify(receipt(build), null, 2));
    console.log('BUILD_QUEUED=' + JSON.stringify(receipt(build)));
  }
  const deadline = Date.now() + 45 * 60 * 1000;
  while (Date.now() < deadline) {
    builds = await snapshot();
    const ios = candidate(builds, 'IOS', 'testflight');
    const android = candidate(builds, 'ANDROID', 'preview');
    if (!ios || !android) throw Error('Missing build');
    if (ios.submissions?.some(s => s.iosConfig?.ascAppIdentifier !== '6773071994' || ['ERRORED', 'CANCELED'].includes(s.status))) throw Error('iOS submission requires inspection');
    const status = { ios: receipt(ios), android: receipt(android) };
    fs.writeFileSync('build-receipts/status.json', JSON.stringify(status, null, 2));
    console.log('RELEASE_STATUS=' + JSON.stringify(status));
    if (ios.status === 'FINISHED' && android.status === 'FINISHED' && ios.submissions?.some(s => s.status === 'FINISHED')) {
      if (!android.artifacts?.applicationArchiveUrl?.includes('.apk')) throw Error('Expected APK artifact');
      console.log('RELEASE_COMPLETE=' + JSON.stringify(status));
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 45000));
  }
  throw Error('Builds still pending; inspect exact IDs before retrying');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
