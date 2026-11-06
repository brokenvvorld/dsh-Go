#!/usr/bin/env python3
"""Exercise the bundled OpenAI plugin in a real, isolated DSH Host, without an API key.
DSH_PREFIX=/path/to/patched/runtime python3 runtime/tests/openai-host-live.py
"""
import http.cookiejar
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.request

prefix = Path(os.environ['DSH_PREFIX']).resolve()
source = Path(__file__).resolve().parents[1] / 'openai/dsh-go-openai'
with tempfile.TemporaryDirectory(prefix='openai-host-') as tmp:
    root = Path(tmp)
    profile = root / 'home/profiles/web'
    (profile / 'node_modules').mkdir(parents=True)
    plugin = root / 'dsh-go-openai'
    shutil.copytree(source, plugin)
    (plugin / 'node_modules').symlink_to(prefix / 'node_modules', target_is_directory=True)
    (profile / 'node_modules/dsh-go-openai').symlink_to(plugin, target_is_directory=True)
    (profile / 'package.json').write_text(json.dumps({
        'name': 'openai-host-fixture', 'version': '1.0.0', 'private': True,
        'dsh': {'profile': {'bundles': ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']}}
    }))
    observer = root / 'observer.mjs'
    observer.write_text('''export const name = 'openai-host-observer';
export const inject = ['tools', 'webServer', 'connection'];
export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({kind:'exact', path:'/openai-fixture', handler:async(req,res) => {
    const status=ctx.connection.requestRejection(req); if(status!==undefined){res.writeHead(status);res.end();return;}
    const names=['openai_catalog','openai_call','openai_decide'];
    const found=names.filter(n=>ctx.tools.get(n));
    const catalog=JSON.parse(await ctx.tools.get('openai_catalog').execute({family:'decisions'}));
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({found,catalog}));
  }}));
}''')
    disabled = ['session-title-llm', 'llm-pi-ai', 'llm-deepseek-account', 'session-telemetry-otel', 'web-search-deepseek', 'web-deepseek-api', 'web-fetch-http', 'tool-web']
    (profile / 'cordis.patch.yml').write_text(json.dumps([{'id': x, 'disabled': True} for x in disabled] + [{'insert': [{'id': 'dsh-go-openai', 'name': str(plugin / 'lib/index.js')}, {'id': 'openai-observer', 'name': str(observer)}]}]))
    workspace = root / 'workspace'
    workspace.mkdir()
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    base = f'http://127.0.0.1:{port}'
    env = {k: os.environ[k] for k in ['PATH', 'LANG', 'LC_ALL', 'TMPDIR'] if k in os.environ}
    env.update(DSH_HOME=str(root / 'home'), DSH_AGENTS_HOME=str(root / 'agents'), DSH_TELEMETRY_DISABLED='1', UV_USE_IO_URING='0')
    log = root / 'host.log'
    with log.open('w') as handle:
        host = subprocess.Popen(['node', str(prefix / 'node_modules/@deepseek-ai/dsh/lib/bin.js'), 'web', '--no-open', '--host', '127.0.0.1', '--port', str(port)], cwd=workspace, env=env, stdout=handle, stderr=subprocess.STDOUT)
        try:
            deadline = time.monotonic() + 40
            while True:
                text = log.read_text()
                token = re.search(r'token=([\w-]+)', text)
                if token:
                    break
                if host.poll() is not None or time.monotonic() > deadline:
                    raise RuntimeError('Host did not start: ' + re.sub(r'token=[\w-]+', 'token=[redacted]', text)[-5000:])
                time.sleep(.05)
            op = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
            op.open(base + '/?token=' + token[1], timeout=10).read()
            def rpc(name, args):
                request = urllib.request.Request(base + '/api/' + name, data=json.dumps({'type': 'client-request', 'rpcId': 'test', 'method': name, 'payload': {'args': args}}).encode(), headers={'Content-Type': 'application/json', 'Origin': base})
                with op.open(request, timeout=10) as response:
                    return json.load(response)["result"]
            proof = json.load(op.open(base + '/openai-fixture', timeout=10))
            assert proof['found'] == ['openai_catalog', 'openai_call', 'openai_decide'], proof
            assert proof['catalog']['operations'][0]['path'] == '/decisions', proof
            result = rpc('settings/describe', {})
            assert result.get('ok'), result
            rows = [r for r in result['value']['namespaces'] if r['ns'] == 'dsh-go-openai']
            assert len(rows) == 1, 'OpenAI settings namespace missing'
            row = rows[0]
            assert row['value']['enabled'] is True, row['value']
            assert row['value']['responseModel'] == 'gpt-6.1-sol', row['value']
            changed = rpc('settings/mutate', {'ns': row['ns'], 'expectedRevision': row['revision'], 'ops': [{'op': 'set', 'path': ['enabled'], 'value': False}]})
            assert changed.get('ok'), changed
            updated = rpc('settings/describe', {})
            assert next(r for r in updated['value']['namespaces'] if r['ns'] == row['ns'])['value']['enabled'] is False
            request = urllib.request.Request(base + '/openai/v1/voice/start', data=b'{"kind":"live","sdp":"v=0"}', headers={'Content-Type': 'application/json', 'Origin': base})
            try:
                op.open(request, timeout=10)
                raise AssertionError('Disabled plugin started a call')
            except urllib.error.HTTPError as error:
                assert error.code == 502
                assert json.load(error)['error'] == 'OPENAI_DISABLED'
            print('PASS: real DSH loaded all three tools and OpenAI settings, persisted a change, and denied voice while disabled; no OpenAI calls made.')
        finally:
            host.terminate()
            try:
                host.wait(timeout=10)
            except subprocess.TimeoutExpired:
                host.kill()
                host.wait(timeout=5)
