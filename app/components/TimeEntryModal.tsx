'use client';

import { useState, useEffect } from 'react';

interface Person {
  id: string;
  name: string;
  createdAt: string;
}

interface TimeEntry {
  id: string;
  personId: string;
  title: string;
  startHour: number;
  endHour: number;
  color: string;
  date: string;
  createdAt: string;
}

interface TimeEntryModalProps {
  isOpen: boolean;
  onClose: () => void;
  persons: Person[];
  editEntry?: TimeEntry | null;
  defaultPersonId?: string;
  defaultHour?: number;
  date: string;
}

const PRESET_COLORS = [
  '#3b82f6', // 蓝色
  '#22c55e', // 绿色
  '#f97316', // 橙色
  '#a855f7', // 紫色
  '#ef4444', // 红色
  '#eab308', // 黄色
  '#06b6d4', // 青色
  '#ec4899', // 粉色
  '#6366f1', // 靛蓝
  '#14b8a6', // 蓝绿
];

export default function TimeEntryModal({
  isOpen,
  onClose,
  persons,
  editEntry,
  defaultPersonId,
  defaultHour,
  date,
}: TimeEntryModalProps) {
  const [personId, setPersonId] = useState<string>('');
  const [title, setTitle] = useState('');
  const [startHour, setStartHour] = useState(9);
  const [startMinute, setStartMinute] = useState(0);
  const [endHour, setEndHour] = useState(10);
  const [endMinute, setEndMinute] = useState(0);
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [entryDate, setEntryDate] = useState(date);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isEditMode = !!editEntry;

  // 初始化表单数据
  useEffect(() => {
    if (isOpen) {
      if (editEntry) {
        setPersonId(editEntry.personId);
        setTitle(editEntry.title);
        setStartHour(Math.floor(editEntry.startHour));
        setStartMinute((editEntry.startHour % 1) * 60);
        setEndHour(Math.floor(editEntry.endHour));
        setEndMinute((editEntry.endHour % 1) * 60);
        setColor(editEntry.color);
        setEntryDate(editEntry.date);
      } else {
        setPersonId(defaultPersonId ?? '');
        setTitle('');
        setStartHour(defaultHour ?? 9);
        setStartMinute(0);
        setEndHour((defaultHour ?? 9) + 1);
        setEndMinute(0);
        setColor(PRESET_COLORS[0]);
        setEntryDate(date);
      }
      setErrors({});
    }
  }, [isOpen, editEntry, defaultPersonId, defaultHour, date]);

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!personId) {

      newErrors.personId = '请选择人员';
    }

    if (!title.trim()) {
      newErrors.title = '请输入活动名称';
    }

    const startTotal = startHour + startMinute / 60;
    const endTotal = endHour + endMinute / 60;

    if (endTotal <= startTotal) {
      newErrors.endTime = '结束时间必须大于开始时间';
    }

    if (!entryDate) {
      newErrors.date = '请选择日期';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;

    setIsSubmitting(true);
    try {
      const startTotal = startHour + startMinute / 60;
      const endTotal = endHour + endMinute / 60;

      const body = {
        personId,
        title: title.trim(),
        startHour: startTotal,
        endHour: endTotal,
        color,
        date: entryDate,
      };

      const url = isEditMode ? `/api/time-entries/${editEntry.id}` : '/api/time-entries';
      const method = isEditMode ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error('保存失败');
      }

      onClose();
    } catch (error) {
      console.error('保存时间记录失败:', error);
      setErrors({ submit: '保存失败，请重试' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!editEntry || !confirm('确定要删除这条时间记录吗？')) return;

    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/time-entries/${editEntry.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('删除失败');
      }

      onClose();
    } catch (error) {
      console.error('删除时间记录失败:', error);
      setErrors({ submit: '删除失败，请重试' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 transition-opacity duration-200"
      onClick={handleOverlayClick}
    >
      <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-xl w-full max-w-md mx-4 transition-transform duration-200">
        {/* 标题 */}
        <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-700">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            {isEditMode ? '编辑时间记录' : '添加时间记录'}
          </h2>
        </div>

        {/* 表单内容 */}
        <div className="px-6 py-4 space-y-4">
          {/* 人员选择 */}
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              人员
            </label>
            <select
              value={personId}
              onChange={(e) => setPersonId(e.target.value)}
              className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-md bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">请选择人员</option>
              {persons.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
            {errors.personId && (
              <p className="mt-1 text-sm text-red-500">{errors.personId}</p>
            )}
          </div>

          {/* 活动名称 */}
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              活动名称
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="请输入活动名称"
              className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-md bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {errors.title && (
              <p className="mt-1 text-sm text-red-500">{errors.title}</p>
            )}
          </div>

          {/* 时间选择 */}
          <div className="grid grid-cols-2 gap-4">
            {/* 开始时间 */}
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                开始时间
              </label>
              <div className="flex gap-2">
                <select
                  value={startHour}
                  onChange={(e) => setStartHour(Number(e.target.value))}
                  className="flex-1 px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-md bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {Array.from({ length: 24 }, (_, i) => i).map((hour) => (
                    <option key={hour} value={hour}>
                      {hour}
                    </option>
                  ))}
                </select>
                <span className="flex items-center text-zinc-500">:</span>
                <select
                  value={startMinute}
                  onChange={(e) => setStartMinute(Number(e.target.value))}
                  className="flex-1 px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-md bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value={0}>00</option>
                  <option value={30}>30</option>
                </select>
              </div>
            </div>

            {/* 结束时间 */}
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                结束时间
              </label>
              <div className="flex gap-2">
                <select
                  value={endHour}
                  onChange={(e) => setEndHour(Number(e.target.value))}
                  className="flex-1 px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-md bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {Array.from({ length: 24 }, (_, i) => i).map((hour) => (
                    <option key={hour} value={hour}>
                      {hour}
                    </option>
                  ))}
                </select>
                <span className="flex items-center text-zinc-500">:</span>
                <select
                  value={endMinute}
                  onChange={(e) => setEndMinute(Number(e.target.value))}
                  className="flex-1 px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-md bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value={0}>00</option>
                  <option value={30}>30</option>
                </select>
              </div>
              {errors.endTime && (
                <p className="mt-1 text-sm text-red-500">{errors.endTime}</p>
              )}
            </div>
          </div>

          {/* 颜色选择 */}
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
              颜色
            </label>
            <div className="flex flex-wrap gap-2">
              {PRESET_COLORS.map((presetColor) => (
                <button
                  key={presetColor}
                  type="button"
                  onClick={() => setColor(presetColor)}
                  className={`w-8 h-8 rounded-full transition-transform hover:scale-110 ${
                    color === presetColor
                      ? 'ring-2 ring-offset-2 ring-zinc-400 dark:ring-offset-zinc-900'
                      : ''
                  }`}
                  style={{ backgroundColor: presetColor }}
                  aria-label={`选择颜色 ${presetColor}`}
                />
              ))}
            </div>
          </div>

          {/* 日期选择 */}
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              日期
            </label>
            <input
              type="date"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
              className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-md bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {errors.date && (
              <p className="mt-1 text-sm text-red-500">{errors.date}</p>
            )}
          </div>

          {/* 错误提示 */}
          {errors.submit && (
            <p className="text-sm text-red-500 text-center">{errors.submit}</p>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="px-6 py-4 border-t border-zinc-200 dark:border-zinc-700 flex justify-end gap-3">
          {isEditMode && (
            <button
              onClick={handleDelete}
              disabled={isSubmitting}
              className="px-4 py-2 text-sm font-medium text-white bg-red-500 rounded-md hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:opacity-50 dark:focus:ring-offset-zinc-900"
            >
              删除
            </button>
          )}
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-700 rounded-md hover:bg-zinc-200 dark:hover:bg-zinc-600 focus:outline-none focus:ring-2 focus:ring-zinc-500 focus:ring-offset-2 disabled:opacity-50 dark:focus:ring-offset-zinc-900"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-500 rounded-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 dark:focus:ring-offset-zinc-900"
          >
            {isSubmitting ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
