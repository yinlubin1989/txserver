'use client';

import { useState, useEffect } from 'react';

interface AuthModalProps {
  onClose: () => void;
  onSuccess: (user: { id: string; username: string; email: string }) => void;
}

type Tab = 'login' | 'register';

interface FormErrors {
  login?: string;
  password?: string;
  username?: string;
  email?: string;
  confirmPassword?: string;
  submit?: string;
}

export default function AuthModal({ onClose, onSuccess }: AuthModalProps) {
  const [activeTab, setActiveTab] = useState<Tab>('login');
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});

  // Login form state
  const [loginField, setLoginField] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Register form state
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  useEffect(() => {
    setErrors({});
    setLoginField('');
    setLoginPassword('');
    setUsername('');
    setEmail('');
    setPassword('');
    setConfirmPassword('');
  }, []);

  useEffect(() => {
    setErrors({});
  }, [activeTab]);

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const validateLogin = (): boolean => {
    const newErrors: FormErrors = {};
    if (!loginField.trim()) newErrors.login = '请输入用户名或邮箱';
    if (!loginPassword) newErrors.password = '请输入密码';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const validateRegister = (): boolean => {
    const newErrors: FormErrors = {};
    if (!username.trim()) newErrors.username = '请输入用户名';
    if (!email.trim()) newErrors.email = '请输入邮箱';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) newErrors.email = '邮箱格式不正确';
    if (!password) newErrors.password = '请输入密码';
    else if (password.length < 6) newErrors.password = '密码至少6位';
    if (!confirmPassword) newErrors.confirmPassword = '请确认密码';
    else if (password !== confirmPassword) newErrors.confirmPassword = '两次密码不一致';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleLogin = async () => {
    if (!validateLogin()) return;
    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: loginField, password: loginPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrors({ submit: data.message || data.error || '登录失败' });
        return;
      }
      onSuccess(data.user);
      onClose();
    } catch {
      setErrors({ submit: '网络错误，请重试' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegister = async () => {
    if (!validateRegister()) return;
    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrors({ submit: data.message || data.error || '注册失败' });
        return;
      }
      onSuccess(data.user);
      onClose();
    } catch {
      setErrors({ submit: '网络错误，请重试' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={handleOverlayClick}
    >
      <div className="relative w-full max-w-md mx-4 bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
        {/* Close button */}
        <button
          onClick={onClose}
          aria-label="关闭"
          className="absolute top-4 right-4 z-10 w-8 h-8 flex items-center justify-center rounded-full text-white/50 hover:text-white hover:bg-white/10 transition-all duration-150"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M2 2l12 12M14 2L2 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </button>

        {/* Tab bar */}
        <div className="flex border-b border-white/10">
          {(['login', 'register'] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-4 text-sm font-medium transition-all duration-200 relative ${
                activeTab === tab ? 'text-white' : 'text-white/40 hover:text-white/70'
              }`}
            >
              {tab === 'login' ? '登录' : '注册'}
              {activeTab === tab && (
                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full" />
              )}
            </button>
          ))}
        </div>

        {/* Form area */}
        <div className="p-6">
          {activeTab === 'login' ? (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-white/60 mb-1.5">用户名或邮箱</label>
                <input
                  type="text"
                  value={loginField}
                  onChange={(e) => setLoginField(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                  placeholder="请输入用户名或邮箱"
                  autoComplete="username"
                  className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/25 text-sm focus:outline-none focus:border-blue-500/60 focus:bg-white/8 transition-all duration-150"
                />
                {errors.login && <p className="mt-1.5 text-xs text-red-400">{errors.login}</p>}
              </div>

              <div>
                <label className="block text-xs font-medium text-white/60 mb-1.5">密码</label>
                <input
                  type="password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                  placeholder="请输入密码"
                  autoComplete="current-password"
                  className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/25 text-sm focus:outline-none focus:border-blue-500/60 focus:bg-white/8 transition-all duration-150"
                />
                {errors.password && <p className="mt-1.5 text-xs text-red-400">{errors.password}</p>}
              </div>

              {errors.submit && (
                <p className="text-xs text-red-400 text-center py-1">{errors.submit}</p>
              )}

              <button
                onClick={handleLogin}
                disabled={isLoading}
                className="w-full py-2.5 mt-2 rounded-lg bg-gradient-to-r from-blue-500 to-purple-600 text-white text-sm font-medium hover:opacity-90 active:scale-[0.98] transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? '登录中...' : '登录'}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-white/60 mb-1.5">用户名</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="请输入用户名"
                  autoComplete="username"
                  className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/25 text-sm focus:outline-none focus:border-blue-500/60 focus:bg-white/8 transition-all duration-150"
                />
                {errors.username && <p className="mt-1.5 text-xs text-red-400">{errors.username}</p>}
              </div>

              <div>
                <label className="block text-xs font-medium text-white/60 mb-1.5">邮箱</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="请输入邮箱"
                  autoComplete="email"
                  className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/25 text-sm focus:outline-none focus:border-blue-500/60 focus:bg-white/8 transition-all duration-150"
                />
                {errors.email && <p className="mt-1.5 text-xs text-red-400">{errors.email}</p>}
              </div>

              <div>
                <label className="block text-xs font-medium text-white/60 mb-1.5">密码</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="请输入密码（至少6位）"
                  autoComplete="new-password"
                  className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/25 text-sm focus:outline-none focus:border-blue-500/60 focus:bg-white/8 transition-all duration-150"
                />
                {errors.password && <p className="mt-1.5 text-xs text-red-400">{errors.password}</p>}
              </div>

              <div>
                <label className="block text-xs font-medium text-white/60 mb-1.5">确认密码</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleRegister()}
                  placeholder="请再次输入密码"
                  autoComplete="new-password"
                  className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/25 text-sm focus:outline-none focus:border-blue-500/60 focus:bg-white/8 transition-all duration-150"
                />
                {errors.confirmPassword && <p className="mt-1.5 text-xs text-red-400">{errors.confirmPassword}</p>}
              </div>

              {errors.submit && (
                <p className="text-xs text-red-400 text-center py-1">{errors.submit}</p>
              )}

              <button
                onClick={handleRegister}
                disabled={isLoading}
                className="w-full py-2.5 mt-2 rounded-lg bg-gradient-to-r from-blue-500 to-purple-600 text-white text-sm font-medium hover:opacity-90 active:scale-[0.98] transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? '注册中...' : '注册'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
