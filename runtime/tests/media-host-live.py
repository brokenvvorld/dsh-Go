#!/usr/bin/env python3
"""Verify the shipped media bundle against a real Host, without paid API calls.
DSH_PREFIX must be an assembled-equivalent tree: pinned patches, in-box media,
image-size, and the media dependency declared on the DSH installation manifest.
"""
import http.cookiejar
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import tempfile
import time
import urllib.request

prefix = Path(os.environ['DSH_PREFIX']).resolve()
legacy_name = '@ccch1mneyyy/dsh-media'
# Read-only inventory/schema discovery must never initialize or rewrite a profile.
with tempfile.TemporaryDirectory(prefix='media-readonly-') as tmp:
    profile = Path(tmp)
    original = json.dumps({'name': 'media-readonly', 'version': '1.0.0',
        'dsh': {'profile': {'bundles': ['@deepseek-ai/dsh-base']}}})
    (profile / 'package.json').write_text(original)
    check = """const {loadProfileDirectory}=await import(process.argv[1]);
const result=loadProfileDirectory('dsh', process.argv[2], process.argv[3], {readOnly:true});
if(!result.layers.some(layer=>layer.packageName==='@ccch1mneyyy/dsh-media')) throw Error('media absent');"""
    subprocess.run(['node', '--input-type=module', '-e', check,
        (prefix / 'node_modules/@deepseek-ai/dsh-app-boot/lib/index.js').as_uri(),
        str(profile), str(prefix / 'node_modules/@deepseek-ai/dsh/package.json')], check=True)
    assert (profile / 'package.json').read_text() == original
for scenario in ['fresh-no-key', 'fresh-openai', 'existing-media', 'safe-mode']:
    with tempfile.TemporaryDirectory(prefix='media-host-') as tmp:
        root = Path(tmp)
        profile = root / 'home/profiles/web'
        profile.mkdir(parents=True)
        bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']
        manifest = {'name': 'media-host-fixture', 'version': '1.0.0', 'private': True}
        patches = []
        if scenario == 'existing-media':
            bundles.append(legacy_name)
            manifest['dependencies'] = {legacy_name: '0.2.1'}
            old = profile / 'node_modules' / legacy_name
            old.mkdir(parents=True)
            (old / 'package.json').write_text(json.dumps({
                'name': legacy_name, 'version': '0.2.1', 'type': 'module',
                'dsh': {'bundle': {'patch': './cordis.patch.yml'}},
                'peerDependencies': {'@deepseek-ai/dsh-tools': '0.2.1-rc.4'},
            }))
            (old / 'cordis.patch.yml').write_text(json.dumps([{'insert': [{'id': 'dsh-media', 'name': legacy_name}]}]))
            (old / 'index.js').write_text('throw new Error("OLD_MEDIA_MUST_NOT_LOAD")')
            patches.append({'id': 'dsh-media', 'name': legacy_name, 'config': {
                'services': [{'id': 'kept_image', 'label': 'Kept service', 'enabled': True,
                    'provider': 'openai', 'baseUrl': 'https://api.openai.com/v1',
                    'profile': 'openai-gpt-image', 'models': 'gpt-image-2.5-flare',
                    'keyRef': 'LEGACY_MEDIA_KEY'}],
                'defaults': {'imageServiceId': 'kept_image', 'imageModelId': 'gpt-image-2.5-flare'},
                'budget': {'dailyCny': '25', 'unknownPriceHoldCny': '10'},
            }})
        manifest['dsh'] = {'profile': {'bundles': bundles}}
        (profile / 'package.json').write_text(json.dumps(manifest))
        observer = root / 'observer.mjs'
        observer.write_text('''export const inject = ['tools', 'webServer', 'connection'];
export function apply(ctx) {
 ctx.effect(() => ctx.webServer.register({kind:'exact', path:'/media-proof', handler:async(req,res) => {
  const status=ctx.connection.requestRejection(req); if(status!==undefined){res.writeHead(status);res.end();return;}
  const entries=[...ctx.loader.entries()].filter(e=>e.options.id==='dsh-media');
  const tools=['generate_image','edit_image','generate_video'].filter(n=>ctx.tools.get(n));
  const models=ctx.tools.get('generate_image')?.parameters.properties.modelId.enum;
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({entries:entries.map(e=>({id:e.options.id,name:e.options.name})),tools,models}));
 }}));
}''')
        disabled = ['session-title-llm', 'llm-pi-ai', 'llm-deepseek-account', 'session-telemetry-otel',
                    'web-search-deepseek', 'web-deepseek-api', 'tool-web']
        patches += [{'id': name, 'disabled': True} for name in disabled]
        patches.append({'insert': [{'id': 'media-observer', 'name': str(observer)}]})
        (profile / 'cordis.patch.yml').write_text(json.dumps(patches))
        workspace = root / 'workspace'
        workspace.mkdir()
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        base = f'http://127.0.0.1:{port}'
        env = {k: os.environ[k] for k in ['PATH', 'LANG', 'LC_ALL', 'TMPDIR'] if k in os.environ}
        env.update(DSH_HOME=str(root / 'home'), DSH_AGENTS_HOME=str(root / 'agents'),
                   DSH_TELEMETRY_DISABLED='1', UV_USE_IO_URING='0')
        if scenario in ['fresh-openai', 'safe-mode']: env['OPENAI_API_KEY'] = 'SYNTHETIC_NOT_REAL'
        if scenario == 'existing-media': env['LEGACY_MEDIA_KEY'] = 'SYNTHETIC_NOT_REAL'
        if scenario == 'safe-mode': env['DSH_APP_SAFE_MODE'] = '1'
        log = root / 'host.log'
        with log.open('w') as handle:
            host = subprocess.Popen(['node', str(prefix / 'node_modules/@deepseek-ai/dsh/lib/bin.js'),
                'web', '--no-open', '--host', '127.0.0.1', '--port', str(port)],
                cwd=workspace, env=env, stdout=handle, stderr=subprocess.STDOUT)
            try:
                deadline = time.monotonic() + 40
                while True:
                    output = log.read_text()
                    token = re.search(r'token=([\w-]+)', output)
                    if token: break
                    if host.poll() is not None or time.monotonic() > deadline:
                        raise RuntimeError('Host did not start: ' + re.sub(r'token=[\w-]+', 'token=[redacted]', output)[-6000:])
                    time.sleep(.05)
                op = urllib.request.build_opener(urllib.request.ProxyHandler({}),
                    urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
                op.open(base + '/?token=' + token[1], timeout=10).read()
                def rpc(method, args):
                    req = urllib.request.Request(base + '/api/' + method,
                        data=json.dumps({'type': 'client-request', 'rpcId': 'test', 'method': method,
                            'payload': {'args': args}}).encode(),
                        headers={'Content-Type': 'application/json', 'Origin': base})
                    return json.load(op.open(req, timeout=10))['result']
                proof = json.load(op.open(base + '/media-proof', timeout=10))
                if scenario == 'safe-mode':
                    assert proof['entries'] == [] and proof['tools'] == [], proof
                    assert 'mediaBundleInitialized' not in (profile / 'package.json').read_text()
                    print(json.dumps({'scenario': scenario, 'result': 'passed', 'mediaLoaded': False}))
                    continue
                assert proof['entries'] == [{'id': 'dsh-media', 'name': legacy_name}], proof
                expected_tools = [] if scenario == 'fresh-no-key' else ['generate_image', 'edit_image']
                described = rpc('settings/describe', {})
                assert described['ok'], described
                rows = [r for r in described['value']['namespaces'] if r['ns'] == 'dsh-media']
                assert len(rows) == 1, {'missingMediaSettings': rows, 'log': re.sub(r'token=[\w-]+', 'token=[redacted]', log.read_text())[-8000:]}
                row = rows[0]
                services = row['value']['services']
                assert proof['tools'] == expected_tools, {'proof': proof, 'value': row['value'], 'log': re.sub(r'token=[\w-]+', 'token=[redacted]', log.read_text())[-4000:]}
                if scenario == 'existing-media':
                    assert services[0]['id'] == 'kept_image' and services[0]['keyRef'] == 'LEGACY_MEDIA_KEY', services
                    assert row['value']['defaults']['imageServiceId'] == 'kept_image'
                    assert row['value']['budget']['dailyCny'] == '25'
                    assert proof['models'] == ['gpt-image-2.5-flare'], proof
                else:
                    assert services[0]['keyRef'] == 'OPENAI_API_KEY', services
                    assert services[0]['models'].startswith('gpt-image-2.6-flare'), services
                changed = rpc('settings/mutate', {'ns': row['ns'], 'expectedRevision': row['revision'],
                    'ops': [{'op': 'set', 'path': ['limits', 'maxImages'], 'value': 2}]})
                assert changed['ok'], changed
                updated = rpc('settings/describe', {})
                assert next(r for r in updated['value']['namespaces'] if r['ns'] == 'dsh-media')['value']['limits']['maxImages'] == 2
                assert 'OLD_MEDIA_MUST_NOT_LOAD' not in log.read_text()
                assert 'SYNTHETIC_NOT_REAL' not in log.read_text()
                listed = rpc('pluginManager/listBundles', {})
                assert listed.get('ok'), listed
                bundle = next(b for b in listed['value'] if b['name'] == legacy_name)
                assert bundle['enabled'] is True and bundle['availability'] == 'installation', bundle
                assert bundle['version'] == '0.3.1' and not bundle.get('error'), bundle
                if scenario == 'fresh-openai':
                    disabled = rpc('pluginManager/setBundleEnabled', {'name': legacy_name, 'enabled': False})
                    assert disabled.get('ok') and disabled['value']['application'] in ['applied', 'restart-required'], disabled
                    assert legacy_name not in json.loads((profile / 'package.json').read_text())['dsh']['profile']['bundles']
                    disabled_inventory = rpc('pluginManager/listBundles', {})
                    assert next(b for b in disabled_inventory['value'] if b['name'] == legacy_name)['enabled'] is False
                    # Reading/loading the profile after disable must not re-add it.
                    rpc('settings/describe', {})
                    assert legacy_name not in json.loads((profile / 'package.json').read_text())['dsh']['profile']['bundles']
                    # Restart the real Host with the just-written profile selection.
                    host.terminate()
                    host.wait(timeout=10)
                    handle.flush()
                    offset = log.stat().st_size
                    host = subprocess.Popen(['node', str(prefix / 'node_modules/@deepseek-ai/dsh/lib/bin.js'),
                        'web', '--no-open', '--host', '127.0.0.1', '--port', str(port)],
                        cwd=workspace, env=env, stdout=handle, stderr=subprocess.STDOUT)
                    restart_deadline = time.monotonic() + 40
                    while True:
                        new_token = re.search(r'token=([\w-]+)', log.read_text()[offset:])
                        if new_token: break
                        assert host.poll() is None and time.monotonic() < restart_deadline, 'Host restart failed'
                        time.sleep(.05)
                    op = urllib.request.build_opener(urllib.request.ProxyHandler({}),
                        urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
                    op.open(base + '/?token=' + new_token[1], timeout=10).read()
                    after_restart = json.load(op.open(base + '/media-proof', timeout=10))
                    assert after_restart['entries'] == [] and after_restart['tools'] == [], after_restart
                    assert next(b for b in rpc('pluginManager/listBundles', {})['value'] if b['name'] == legacy_name)['enabled'] is False
                    enabled = rpc('pluginManager/setBundleEnabled', {'name': legacy_name, 'enabled': True})
                    assert enabled.get('ok') and enabled['value']['application'] in ['applied', 'restart-required'], enabled
                    assert next(b for b in rpc('pluginManager/listBundles', {})['value'] if b['name'] == legacy_name)['enabled'] is True
                    if enabled['value']['application'] == 'applied':
                        assert any(r['ns'] == 'dsh-media' for r in rpc('settings/describe', {})['value']['namespaces'])
                print(json.dumps({'scenario': scenario, 'result': 'passed', 'tools': proof['tools'],
                    'settingsWritable': True, 'oldConfigurationPreserved': scenario == 'existing-media',
                    'paidRequests': 0, 'bundleInventoryOk': listed.get('ok', True)}, ensure_ascii=False))
            finally:
                host.terminate()
                try: host.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    host.kill()
                    host.wait(timeout=5)
