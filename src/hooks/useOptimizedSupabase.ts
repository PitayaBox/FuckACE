import { useState, useEffect } from 'react';

// 移除了未使用的 currentVersion 参数
export function useInitialData() {
  const [announcements, setAnnouncements] = useState<any[]>([]);

  useEffect(() => {
    // 这里就是你的【本地公告栏】
    setAnnouncements([
      {
        id: 1,
        priority: 'normal',
        title: '本地纯净版已就绪',
        content: '1. 已移除所有联网追踪功能\n2. 已移除特定游戏优化\n3. 纯净本地运行',
        created_at: new Date().toISOString()
      }
    ]);
  }, []);

  return {
    announcements,
    latestVersion: null,
    hasUpdate: false
  };
}