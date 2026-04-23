'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

interface Todo {
  id: number;
  title: string;
  completed: boolean;
  createdAt: string;
}

type FilterType = 'all' | 'active' | 'completed';

export default function TodoApp() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  // 获取 todos
  const fetchTodos = useCallback(async () => {
    try {
      const res = await fetch('/api/todos');
      if (res.ok) {
        const data = await res.json();
        setTodos(data.todos || []);
      }
    } catch (error) {
      console.error('Failed to fetch todos:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTodos();
    const timer = setTimeout(() => setMounted(true), 100);
    return () => clearTimeout(timer);
  }, [fetchTodos]);

  // 聚焦编辑输入框
  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  // 添加 todo
  const addTodo = async () => {
    const title = inputValue.trim();
    if (!title) return;

    try {
      const res = await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      if (res.ok) {
        const data = await res.json();
        setTodos(prev => [...prev, data.todo]);
        setInputValue('');
      }
    } catch (error) {
      console.error('Failed to add todo:', error);
    }
  };

  // 切换完成状态
  const toggleTodo = async (id: number, completed: boolean) => {
    try {
      const res = await fetch(`/api/todos?id=${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed: !completed }),
      });
      if (res.ok) {
        setTodos(prev =>
          prev.map(todo =>
            todo.id === id ? { ...todo, completed: !completed } : todo
          )
        );
      }
    } catch (error) {
      console.error('Failed to toggle todo:', error);
    }
  };

  // 更新标题
  const updateTitle = async (id: number, title: string) => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setEditingId(null);
      return;
    }

    try {
      const res = await fetch(`/api/todos?id=${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmedTitle }),
      });
      if (res.ok) {
        setTodos(prev =>
          prev.map(todo =>
            todo.id === id ? { ...todo, title: trimmedTitle } : todo
          )
        );
      }
    } catch (error) {
      console.error('Failed to update todo:', error);
    }
    setEditingId(null);
  };

  // 删除 todo
  const deleteTodo = async (id: number) => {
    try {
      const res = await fetch(`/api/todos?id=${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setTodos(prev => prev.filter(todo => todo.id !== id));
      }
    } catch (error) {
      console.error('Failed to delete todo:', error);
    }
  };

  // 清除已完成
  const clearCompleted = async () => {
    const completedIds = todos.filter(t => t.completed).map(t => t.id);
    for (const id of completedIds) {
      await deleteTodo(id);
    }
  };

  // 键盘事件处理
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      addTodo();
    }
  };

  const handleEditKeyDown = (e: React.KeyboardEvent, id: number) => {
    if (e.key === 'Enter') {
      updateTitle(id, editValue);
    } else if (e.key === 'Escape') {
      setEditingId(null);
    }
  };

  // 过滤后的 todos
  const filteredTodos = todos.filter(todo => {
    if (filter === 'active') return !todo.completed;
    if (filter === 'completed') return todo.completed;
    return true;
  });

  const completedCount = todos.filter(t => t.completed).length;
  const totalCount = todos.length;

  return (
    <div
      className="w-full max-w-xl mx-auto px-4"
      style={{
        opacity: mounted ? 1 : 0,
        transform: mounted ? 'translateY(0)' : 'translateY(20px)',
        transition: 'all 0.6s cubic-bezier(0.23, 1, 0.32, 1)',
      }}
    >
      {/* 主卡片容器 */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{
          background: 'linear-gradient(165deg, rgba(255, 255, 255, 0.08) 0%, rgba(255, 255, 255, 0.03) 50%, rgba(255, 255, 255, 0.06) 100%)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
        }}
      >
        {/* 标题 */}
        <div className="px-6 pt-6 pb-4">
          <h2
            className="text-2xl font-light tracking-wide"
            style={{
              color: 'transparent',
              background: 'linear-gradient(135deg, #f8f7f4 0%, #e8b4a0 50%, #f8f7f4 100%)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
            }}
          >
            Todo List
          </h2>
          <p className="text-sm mt-1" style={{ color: 'rgba(232, 180, 160, 0.5)', letterSpacing: '0.15em' }}>
            记录待办事项
          </p>
        </div>

        {/* 输入区域 */}
        <div className="px-6 pb-4">
          <div className="flex gap-3">
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="添加新的待办事项..."
              className="flex-1 px-4 py-3 rounded-xl outline-none transition-all duration-300"
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                color: 'var(--foreground)',
              }}
            />
            <button
              onClick={addTodo}
              disabled={!inputValue.trim()}
              className="px-5 py-3 rounded-xl font-medium transition-all duration-300 disabled:opacity-40"
              style={{
                background: 'linear-gradient(135deg, rgba(232, 180, 160, 0.3) 0%, rgba(212, 165, 116, 0.2) 100%)',
                border: '1px solid rgba(232, 180, 160, 0.2)',
                color: 'var(--foreground)',
              }}
            >
              添加
            </button>
          </div>
        </div>

        {/* 过滤 Tabs */}
        <div className="px-6 pb-3">
          <div className="flex gap-2">
            {(['all', 'active', 'completed'] as FilterType[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className="px-4 py-2 rounded-lg text-sm transition-all duration-300"
                style={{
                  background: filter === f ? 'rgba(232, 180, 160, 0.15)' : 'transparent',
                  border: filter === f ? '1px solid rgba(232, 180, 160, 0.25)' : '1px solid transparent',
                  color: filter === f ? 'var(--foreground)' : 'rgba(248, 247, 244, 0.5)',
                }}
              >
                {f === 'all' ? '全部' : f === 'active' ? '进行中' : '已完成'}
              </button>
            ))}
          </div>
        </div>

        {/* Todo 列表 */}
        <div className="px-6 pb-4 max-h-96 overflow-y-auto">
          {loading ? (
            <div className="py-12 text-center" style={{ color: 'rgba(232, 180, 160, 0.4)' }}>
              加载中...
            </div>
          ) : filteredTodos.length === 0 ? (
            <div className="py-12 text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full mb-4" style={{ background: 'rgba(232, 180, 160, 0.1)' }}>
                <svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: 'rgba(232, 180, 160, 0.4)' }}>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
              <p style={{ color: 'rgba(232, 180, 160, 0.4)', letterSpacing: '0.1em' }}>
                {filter === 'all' ? '暂无待办事项' : filter === 'active' ? '没有进行中的任务' : '没有已完成的任务'}
              </p>
              <p className="text-xs mt-2" style={{ color: 'rgba(232, 180, 160, 0.25)' }}>
                {filter === 'all' ? '添加一个新任务开始吧' : '切换到其他标签查看更多'}
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {filteredTodos.map((todo, index) => (
                <li
                  key={todo.id}
                  className="group flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300"
                  style={{
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.05)',
                    animationDelay: `${index * 50}ms`,
                  }}
                >
                  {/* 自定义圆形复选框 */}
                  <button
                    onClick={() => toggleTodo(todo.id, todo.completed)}
                    className="relative flex-shrink-0 w-6 h-6 rounded-full transition-all duration-300"
                    style={{
                      border: todo.completed
                        ? '2px solid rgba(232, 180, 160, 0.6)'
                        : '2px solid rgba(255, 255, 255, 0.2)',
                      background: todo.completed
                        ? 'rgba(232, 180, 160, 0.2)'
                        : 'transparent',
                    }}
                    aria-label={todo.completed ? '标记为未完成' : '标记为已完成'}
                  >
                    {/* 勾选动画 */}
                    <svg
                      className="absolute inset-0 m-auto transition-all duration-300"
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      style={{
                        color: 'rgba(232, 180, 160, 0.9)',
                        opacity: todo.completed ? 1 : 0,
                        transform: todo.completed ? 'scale(1)' : 'scale(0.5)',
                      }}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={3}
                        d="M5 13l4 4L19 7"
                        style={{
                          strokeDasharray: 24,
                          strokeDashoffset: todo.completed ? 0 : 24,
                          transition: 'stroke-dashoffset 0.3s ease',
                        }}
                      />
                    </svg>
                  </button>

                  {/* 标题 / 编辑输入框 */}
                  <div className="flex-1 min-w-0">
                    {editingId === todo.id ? (
                      <input
                        ref={editInputRef}
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => handleEditKeyDown(e, todo.id)}
                        onBlur={() => updateTitle(todo.id, editValue)}
                        className="w-full px-3 py-1 rounded-lg outline-none"
                        style={{
                          background: 'rgba(255, 255, 255, 0.1)',
                          border: '1px solid rgba(232, 180, 160, 0.3)',
                          color: 'var(--foreground)',
                        }}
                      />
                    ) : (
                      <span
                        className="block truncate transition-all duration-300"
                        style={{
                          color: todo.completed ? 'rgba(248, 247, 244, 0.4)' : 'var(--foreground)',
                          textDecoration: todo.completed ? 'line-through' : 'none',
                          textDecorationColor: 'rgba(232, 180, 160, 0.4)',
                        }}
                      >
                        {todo.title}
                      </span>
                    )}
                  </div>

                  {/* 操作按钮 */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                    {/* 编辑按钮 */}
                    <button
                      onClick={() => {
                        setEditingId(todo.id);
                        setEditValue(todo.title);
                      }}
                      className="p-2 rounded-lg transition-all duration-200 hover:bg-white/5"
                      style={{ color: 'rgba(232, 180, 160, 0.5)' }}
                      aria-label="编辑"
                    >
                      <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    {/* 删除按钮 */}
                    <button
                      onClick={() => deleteTodo(todo.id)}
                      className="p-2 rounded-lg transition-all duration-200 hover:bg-white/5"
                      style={{ color: 'rgba(201, 100, 100, 0.6)' }}
                      aria-label="删除"
                    >
                      <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 底部统计 */}
        {totalCount > 0 && (
          <div
            className="px-6 py-4 flex items-center justify-between"
            style={{
              borderTop: '1px solid rgba(255, 255, 255, 0.05)',
              background: 'rgba(0, 0, 0, 0.1)',
            }}
          >
            <span className="text-sm" style={{ color: 'rgba(248, 247, 244, 0.5)' }}>
              {completedCount} / {totalCount} 已完成
            </span>
            {completedCount > 0 && (
              <button
                onClick={clearCompleted}
                className="text-sm px-3 py-1 rounded-lg transition-all duration-200 hover:bg-white/5"
                style={{ color: 'rgba(232, 180, 160, 0.5)' }}
              >
                清除已完成
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
