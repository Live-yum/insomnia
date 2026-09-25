import { describe, expect, it } from 'vitest';

import { parseOfflineUiLanguage, translateOfflineSource } from '../offline-localization';

describe('offline source localization', () => {
  it('defaults to mainland Chinese, with only an explicit supported English preference overriding it', () => {
    for (const input of [undefined, null, '', 'zh-CN', 'zh-TW', 'en', {}, '__proto__']) {
      expect(parseOfflineUiLanguage(input)).toBe('zh-CN');
    }
    expect(parseOfflineUiLanguage('en-US')).toBe('en-US');
  });
  it('translates authored interface labels without changing technical identifiers or unknown strings', () => {
    expect(translateOfflineSource('Create new Project', 'zh-CN')).toBe('新建项目');
    expect(translateOfflineSource('Send', 'zh-CN')).toBe('发送');
    expect(translateOfflineSource('Preferences', 'zh-CN')).toBe('偏好设置');
    expect(translateOfflineSource('Send', 'en-US')).toBe('Send');
    for (const text of ['GET', 'application/json', '{"Send":"Create"}', 'https://internal.example/', '__proto__', 'constructor']) {
      expect(translateOfflineSource(text, 'zh-CN')).toBe(text);
    }
  });
});
