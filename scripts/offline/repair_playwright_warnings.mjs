// One-time, reviewable migration of test interaction APIs; never changes assertions.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const directory = path.join(root, 'packages/insomnia-smoke-test/tests/smoke');
const pageFiles = new Set([
  'grpc-interactions.test.ts', 'openapi.test.ts', 'pre-request-script-window.test.ts',
  'preferences-interactions.test.ts', 'socket-io.test.ts', 'spec-toolbar.test.ts', 'websocket.test.ts',
]);
const toastFiles = new Set([
  'plugin-load-order-sandbox-engine-integrity.test.ts', 'plugin-missing-dependency.test.ts',
  'plugin-reload-tag-cache.test.ts', 'plugin-vanish-name-collision.test.ts',
  'plugin-vanish-sibling-missing-dependency.test.ts', 'response-bodypath-read-scope.test.ts',
  'sandbox-template-tags.test.ts',
]);
const methods = new Set(['click', 'dblclick', 'fill', 'press', 'check', 'uncheck', 'hover', 'focus', 'selectOption', 'setInputFiles']);
for (const name of new Set([...pageFiles, ...toastFiles])) {
  const file = path.join(directory, name);
  const original = fs.readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, original, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (source.parseDiagnostics.length) throw new Error('Cannot parse ' + name);
  const edits = [];
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const member = node.expression;
      if (pageFiles.has(name) && member.expression.getText(source) === 'page' && methods.has(member.name.text)) {
        const [selector, ...args] = node.arguments;
        if (!selector || !ts.isStringLiteral(selector)) throw new Error('Review nonliteral page selector in ' + name);
        let locator = 'page.locator(' + selector.getText(source) + ')';
        // Simple text selectors preserve substring matching. Compound selectors
        // retain their original selector expression rather than guessing a role.
        if (selector.text.startsWith('text=') && !selector.text.includes('>>')) {
          const value = selector.text.slice(5);
          if (!value.startsWith('"') && !value.startsWith("'") && !value.startsWith('/')) {
            locator = 'page.getByText(' + JSON.stringify(value) + ')';
          }
        }
        edits.push({ start: node.getStart(source), end: node.end,
          value: locator + '.' + member.name.text + '(' + args.map(arg => arg.getText(source)).join(', ') + ')' });
      }
      if (toastFiles.has(name) && member.name.text === 'click' && member.expression.getText(source).replace(/\s/g, '') === 'dismissButtons.first()') {
        const options = node.arguments[0];
        if (options && ts.isObjectLiteralExpression(options)) {
          const force = options.properties.find(property => ts.isPropertyAssignment(property) && property.name.getText(source) === 'force');
          if (force) {
            if (!ts.isPropertyAssignment(force) || force.initializer.kind !== ts.SyntaxKind.TrueKeyword) throw new Error('Review toast click in ' + name);
            const properties = options.properties.filter(property => property !== force).map(property => property.getText(source));
            edits.push({ start: options.getStart(source), end: options.end, value: '{ ' + properties.join(', ') + ' }' });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  let updated = original;
  let previousStart = original.length;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    if (edit.end > previousStart) throw new Error('Overlapping test edits in ' + name);
    updated = updated.slice(0, edit.start) + edit.value + updated.slice(edit.end);
    previousStart = edit.start;
  }
  if (toastFiles.has(name)) {
    updated = updated.replace(/^\s*\/\/ eslint-disable-next-line playwright\/no-force-option -- necessary to avoid flakiness with re-rendering toast\r?\n/gm, '\n');
  }
  if (updated !== original) {
    fs.writeFileSync(file, updated);
    console.log(name + ': ' + edits.length + ' interaction updates; assertions retained');
  }
}
