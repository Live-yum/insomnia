import { useState } from 'react';

import { setOfflineLocale, useOfflineLocale } from '~/ui/offline-locale';

export const OfflineLanguageSettings = () => {
  const locale = useOfflineLocale();
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const chinese = locale === 'zh-CN';
  const save = async (value: string) => {
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      await setOfflineLocale(value === 'en-US' ? 'en-US' : 'zh-CN');
      setSaved(true);
    } catch {
      setError(chinese ? '语言设置保存失败，请重试。' : 'The language preference could not be saved. Please retry.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="mb-4 flex flex-col gap-2 border-b border-solid border-(--hl-md) pb-4" aria-label="界面语言 / Interface language">
      <label className="flex items-center gap-3">
        <span>界面语言 / Interface language</span>
        <select
          data-testid="offline-interface-language"
          aria-label="界面语言 / Interface language"
          className="rounded-sm border border-solid border-(--hl-md) bg-(--color-bg) p-2 text-(--color-font)"
          value={locale}
          disabled={saving}
          onChange={event => { void save(event.target.value); }}
        >
          <option value="zh-CN">简体中文（中国大陆）</option>
          <option value="en-US">English</option>
        </select>
      </label>
      <p className="text-sm">
        {chinese
          ? '语言资源已随程序提供，无需联网。更改后请保存工作并重新打开应用，使全部界面和系统菜单生效。'
          : 'Language resources are included offline. After changing the language, save your work and reopen the app to apply it to all views and native menus.'}
      </p>
      {saved && <p role="status">{chinese ? '语言设置已保存。' : 'Language preference saved.'}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
};
