const STORAGE_KEY = 'fuckace_settings';

export const storage = {
  // 获取保存的设置
  getChoices: () => {
    try {
      const item = localStorage.getItem(STORAGE_KEY);
      return item ? JSON.parse(item) : {};
    } catch {
      return {};
    }
  },
  // 保存设置
  saveChoices: (choices: any) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(choices));
    } catch (e) {
      console.error("保存设置失败", e);
    }
  },
  // 保留通用的 get/set 以防万一
  get: <T>(key: string): T | null => {
    const item = localStorage.getItem(key);
    try { return item ? JSON.parse(item) : null; } catch { return null; }
  },
  set: (key: string, value: any) => {
    localStorage.setItem(key, JSON.stringify(value));
  }
};