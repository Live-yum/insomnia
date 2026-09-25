'use strict';
// One-time source migration, NOT a runtime DOM/text replacement. Only reviewed,
// authored UI literal contexts are eligible; executable/payload values are untouched.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const ROOT = path.resolve(__dirname, '../..');
const dictionary = require('../../packages/insomnia/src/common/offline-ui-translations.json');
const attrs = new Set(['aria-label', 'placeholder', 'title', 'label', 'help', 'submitName', 'cancelLabel', 'buttonLabel']);
const opaqueTags = new Set(['code', 'pre', 'textarea', 'script', 'style', 'kbd']);
const uiImport = "import { translateOfflineUi } from '~/ui/translate-offline';\n";
const nativeImport = "import { translateNativeOfflineUi } from '~/main/offline-ui-locale';\n";
function normalize(value) { return value.replace(/\s+/g, ' ').trim(); }
function transform(source, fileName, native = false) {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, native ? ts.ScriptKind.TS : ts.ScriptKind.TSX);
  if (sf.parseDiagnostics.length) throw new Error('Invalid input source: ' + fileName);
  const edits = [], hits = [], untranslated = new Set();
  const fn = native ? 'translateNativeOfflineUi' : 'translateOfflineUi';
  function known(text) {
    const value = normalize(text);
    if (Object.hasOwn(dictionary, value)) return value;
    if (/^[A-Za-z][A-Za-z\s,.?!:/()\-]+$/.test(value) && value.length < 180) untranslated.add(value);
    return null;
  }
  function blocked(node) {
    for (let p = node.parent; p; p = p.parent) {
      if (ts.isJsxElement(p) && opaqueTags.has(p.openingElement.tagName.getText(sf))) return true;
    }
    return false;
  }
  function add(start, end, text, original) { edits.push({ start, end, text }); hits.push(original); }
  function expression(expr) {
    if (!expr) return;
    if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
      const key = known(expr.text);
      if (key) add(expr.getStart(sf), expr.end, `${fn}(${JSON.stringify(expr.text)})`, key);
    } else if (ts.isConditionalExpression(expr)) {
      // Never translate the comparison/condition, only its rendered alternatives.
      expression(expr.whenTrue); expression(expr.whenFalse);
    } else if (ts.isParenthesizedExpression(expr)) {
      expression(expr.expression);
    }
  }
  function visit(node) {
    if (native) {
      if (ts.isPropertyAssignment(node) && ['label', 'buttonLabel'].includes(node.name.getText(sf).replace(/^['"]|['"]$/g, ''))) {
        const value = node.initializer;
        let plain;
        if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) plain = value.text;
        if (ts.isTemplateExpression(value) && value.templateSpans.every(span => ts.isIdentifier(span.expression) && span.expression.text === 'MNEMONIC_SYM')) {
          plain = value.head.text + value.templateSpans.map(span => span.literal.text).join('');
        }
        if (plain && known(plain.replaceAll('&', ''))) {
          add(value.getStart(sf), value.end, `${fn}(${value.getText(sf)})`, plain);
        }
        return;
      }
    } else if (!blocked(node)) {
      if (ts.isJsxText(node)) {
        const raw = source.slice(node.pos, node.end);
        const key = known(raw);
        if (key) {
          const leading = /^[ \t]+/.test(raw) && !/^\s*\n/.test(raw) ? ' ' : '';
          const trailing = /[ \t]+$/.test(raw) && !/\n\s*$/.test(raw) ? ' ' : '';
          add(node.pos, node.end, `${leading}{${fn}(${JSON.stringify(key)})}${trailing}`, key);
        }
        return;
      }
      if (ts.isJsxAttribute(node)) {
        if (!attrs.has(node.name.getText(sf))) return;
        const init = node.initializer;
        if (init && ts.isStringLiteral(init)) {
          const key = known(init.text);
          if (key) add(init.getStart(sf), init.end, `{${fn}(${JSON.stringify(init.text)})}`, key);
        } else if (init && ts.isJsxExpression(init)) expression(init.expression);
        return;
      }
      if (ts.isJsxExpression(node) && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
        expression(node.expression);
        return;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  let output = source;
  edits.sort((a,b) => b.start - a.start);
  let limit = source.length;
  for (const edit of edits) {
    if (edit.end > limit) throw new Error('Overlapping source edits: ' + fileName);
    output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
    limit = edit.start;
  }
  if (edits.length && !source.includes(native ? "from '~/main/offline-ui-locale'" : "from '~/ui/translate-offline'")) {
    // Preserve a leading directive prologue when present.
    let insertion = 0;
    for (const statement of sf.statements) {
      if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break;
      insertion = statement.end;
    }
    output = output.slice(0, insertion) + '\n' + (native ? nativeImport : uiImport) + output.slice(insertion);
  }
  if (ts.createSourceFile(fileName, output, ts.ScriptTarget.Latest, true, native ? ts.ScriptKind.TS : ts.ScriptKind.TSX).parseDiagnostics.length) {
    throw new Error('Invalid localized source: ' + fileName);
  }
  return { output, hits, untranslated: [...untranslated] };
}
function main() {
  const base = path.join(ROOT, 'packages/insomnia/src');
  const files = ['root.tsx'];
  for (const dir of ['ui', 'basic-components', 'routes']) {
    for (const name of fs.readdirSync(path.join(base, dir), { recursive: true })) {
      const rel = dir + '/' + String(name).replaceAll('\\', '/');
      if (!rel.endsWith('.tsx') || /(?:__tests__|__fixtures__|\.test\.|\.spec\.|\/assets\/|\/images\/)/.test(rel)) continue;
      if (rel.endsWith('offline-crypto-workbench.tsx') || rel.endsWith('offline-language.tsx')) continue;
      files.push(rel);
    }
  }
  files.push('main/window-utils.ts');
  const report = { schema: 1, migration: 'explicit-authored-ui-literals-only', files: [], remainingLiteralCandidates: [] };
  const remaining = new Set();
  for (const relative of files.sort()) {
    const file = path.join(base, relative);
    const result = transform(fs.readFileSync(file, 'utf8'), relative, relative === 'main/window-utils.ts');
    for (const value of result.untranslated) remaining.add(value);
    if (!result.hits.length) continue;
    fs.writeFileSync(file, result.output);
    report.files.push({ path: 'packages/insomnia/src/' + relative, literals: result.hits.length, sourceKeys: [...new Set(result.hits)].sort() });
  }
  report.remainingLiteralCandidates = [...remaining].sort();
  const total = report.files.reduce((sum, file) => sum + file.literals, 0);
  if (report.files.length < 30 || total < 100) throw new Error('Insufficient real UI source coverage');
  fs.writeFileSync(path.join(ROOT, 'docs/OFFLINE-LOCALIZATION-COVERAGE.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ files: report.files.length, authoredLiterals: total, remainingExamples: report.remainingLiteralCandidates.slice(0, 90) }, null, 2));
}
module.exports = { transform };
if (require.main === module) main();
