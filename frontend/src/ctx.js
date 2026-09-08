import { createContext, useContext } from 'react';

// 全局上下文：当前用户、当前视图、未读计数、刷新函数
export const AppContext = createContext(null);
export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppContext');
  return ctx;
}
