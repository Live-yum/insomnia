'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { transform } = require('./localize-ui.cjs');

test('only authored JSX display literals and approved display attributes are localized', () => {
  const source = `const data = {name:'Send', value:'Body', url:'/Send', key:'Password'};
const c = <div><button aria-label="Send" data-testid="Send" value="Body">Send</button><input placeholder="Search" name="Search" /></div>;`;
  const { output, hits } = transform(source, 'interface.tsx');
  assert.equal(hits.length, 3);
  assert.ok(output.includes("{name:'Send', value:'Body', url:'/Send', key:'Password'}"));
  assert.ok(output.includes('data-testid="Send" value="Body"'));
  assert.ok(output.includes('name="Search"'));
  assert.ok(output.includes('aria-label={translateOfflineUi("Send")}'));
  assert.ok(output.includes('>{translateOfflineUi("Send")}</button>'));
});
test('user expressions, code, JSON, textarea content, protocol methods and comparison operands are not rewritten', () => {
  const source = `const c = <div><code>Send</code><pre>Body</pre><textarea>Password</textarea><span>{request.name}</span><button>{state === 'Send' ? 'Send' : 'Cancel'}</button><span>GET</span><span>{JSON.stringify({Body:'Send'})}</span></div>;`;
  const { output, hits } = transform(source, 'interface.tsx');
  assert.equal(hits.length, 2);
  assert.ok(output.includes('<code>Send</code><pre>Body</pre><textarea>Password</textarea>'));
  assert.ok(output.includes("state === 'Send' ? translateOfflineUi(\"Send\")"));
  assert.ok(output.includes('{request.name}'));
  assert.ok(output.includes("{JSON.stringify({Body:'Send'})}"));
  assert.ok(output.includes('<span>GET</span>'));
});
test('migration is idempotent, preserves directives, and does not wrap existing localized expressions', () => {
  const source = `'use client';\nexport const View = () => <button>Save</button>;`;
  const first = transform(source, 'interface.tsx');
  const second = transform(first.output, 'interface.tsx');
  assert.equal(second.hits.length, 0);
  assert.equal(second.output, first.output);
  assert.ok(first.output.startsWith("'use client';"));
});
test('native localization changes authored labels only, retaining menu roles, identifiers and dynamic user labels', () => {
  const source = 'const menu = [{ label: `${MNEMONIC_SYM}File`, role: "copy", id:"File" }, {label: project.name}, {label:`${item}%`}];';
  const { output, hits } = transform(source, 'window-utils.ts', true);
  assert.equal(hits.length, 1);
  assert.ok(output.includes('translateNativeOfflineUi(`${MNEMONIC_SYM}File`)'));
  assert.ok(output.includes('role: "copy", id:"File"'));
  assert.ok(output.includes('{label: project.name}'));
  assert.ok(output.includes('{label:`${item}%`}'));
});
