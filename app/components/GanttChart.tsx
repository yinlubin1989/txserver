'use client';

import { useState, useRef, useEffect } from 'react';

export interface Person {
  id: string;
  name: string;
  createdAt: string;
}

export interface TimeEntry {
  id: string;
  personId: string;
  title: string;
  startHour: number;
  endHour: number;
  color: string;
  date: string;
  createdAt: string;
}

interface GanttChartProps {
  persons: Person[];
  entries: TimeEntry[];
  date: string;
  onEdit: (entry: TimeEntry) => void;
  onAdd: (personId: string, hour: number) => void;
}

interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  entry: TimeEntry | null;
}

export default function GanttChart({ persons, entries, date, onEdit, onAdd }: GanttChartProps) {
  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false,
    x: 0,
    y: 0,
    entry: null,
  });
  const [currentTimePosition, setCurrentTimePosition] = useState(0);
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 计算当前时间线位置
    const calculatePosition = () => {
      const now = new Date();
      const today = now.toISOString().split('T')[0];

      if (date === today) {
        const hours = now.getHours();
        const minutes = now.getMinutes();
        setCurrentTimePosition((hours + minutes / 60) / 24 * 100);
      } else {
        setCurrentTimePosition(-1); // 隐藏当前时间线
      }
    };

    calculatePosition();
    const interval = setInterval(calculatePosition, 60000); // 每分钟更新一次
    return () => clearInterval(interval);
  }, [date]);

  // 获取某人的时间记录
  const getEntriesForPerson = (personId: string) => {
    return entries.filter(entry => entry.personId === personId);
  };

  // 计算色块位置和宽度
  const getBlockStyle = (entry: TimeEntry) => {
    const left = (entry.startHour / 24) * 100;
    const width = ((entry.endHour - entry.startHour) / 24) * 100;
    return {
      left: `${left}%`,
      width: `${width}%`,
      backgroundColor: entry.color,
    };
  };

  // 处理色块点击
  const handleBlockClick = (e: React.MouseEvent, entry: TimeEntry) => {
    e.stopPropagation();
    onEdit(entry);
  };

  // 处理色块悬浮
  const handleBlockHover = (e: React.MouseEvent, entry: TimeEntry, isEntering: boolean) => {
    if (isEntering) {
      const rect = (e.target as HTMLElement).getBoundingClientRect();
      setTooltip({
        visible: true,
        x: rect.left + rect.width / 2,
        y: rect.top - 10,
        entry,
      });
    } else {
      setTooltip(prev => ({ ...prev, visible: false }));
    }
  };

  // 处理空白区域点击
  const handleEmptyAreaClick = (e: React.MouseEvent, personId: string) => {
    if (!chartRef.current) return;

    const rect = chartRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const hour = (clickX / rect.width) * 24;
    const roundedHour = Math.floor(hour * 2) / 2; // 四舍五入到半小时

    onAdd(personId, roundedHour);
  };

  // 时间刻度 0-23
  const hours = Array.from({ length: 24 }, (_, i) => i);

  return (
    <div className="relative w-full overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
      {/* 顶部时间刻度行 */}
      <div className="flex border-b border-gray-200 dark:border-gray-700">
        {/* 左侧空白占位（人员名称列） */}
        <div className="w-32 min-w-32 flex-shrink-0 border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2">
          <span className="text-sm font-medium text-gray-500 dark:text-gray-400">人员</span>
        </div>
        {/* 时间刻度 */}
        <div className="flex-1 flex" ref={chartRef}>
          {hours.map(hour => (
            <div
              key={hour}
              className="flex-1 text-center text-xs text-gray-500 dark:text-gray-400 border-r border-gray-100 dark:border-gray-800 last:border-r-0 py-2"
            >
              {hour}
            </div>
          ))}
        </div>
      </div>

      {/* 主体区域 - 每个人一行 */}
      {persons.map((person, index) => (
        <div
          key={person.id}
          className={`flex border-b border-gray-200 dark:border-gray-700 last:border-b-0 ${
            index % 2 === 0 ? 'bg-white dark:bg-gray-900' : 'bg-gray-50 dark:bg-gray-800/50'
          }`}
        >
          {/* 左侧人员名称 */}
          <div className="w-32 min-w-32 flex-shrink-0 border-r border-gray-200 dark:border-gray-700 px-3 py-3 flex items-center">
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
              {person.name}
            </span>
          </div>

          {/* 甘特图主体区域 */}
          <div
            className="flex-1 relative h-12 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors"
            onClick={(e) => handleEmptyAreaClick(e, person.id)}
          >
            {/* 背景网格线 */}
            <div className="absolute inset-0 flex">
              {hours.map(hour => (
                <div
                  key={hour}
                  className="flex-1 border-r border-gray-100 dark:border-gray-800 last:border-r-0"
                />
              ))}
            </div>

            {/* 时间记录色块 */}
            {getEntriesForPerson(person.id).map(entry => (
              <div
                key={entry.id}
                className="absolute top-1 bottom-1 rounded-md px-2 flex items-center cursor-pointer shadow-sm hover:shadow-md transition-shadow overflow-hidden group"
                style={getBlockStyle(entry)}
                onClick={(e) => handleBlockClick(e, entry)}
                onMouseEnter={(e) => handleBlockHover(e, entry, true)}
                onMouseLeave={(e) => handleBlockHover(e, entry, false)}
              >
                <span className="text-xs text-white font-medium truncate drop-shadow-sm">
                  {entry.title}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* 当前时间线 */}
      {currentTimePosition >= 0 && (
        <div
          className="absolute top-8 bottom-0 w-0.5 bg-red-500 pointer-events-none z-10"
          style={{ left: `calc(8rem + ${currentTimePosition}% * (100% - 8rem) / 100%)` }}
        >
          <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-red-500" />
        </div>
      )}

      {/* Tooltip */}
      {tooltip.visible && tooltip.entry && (
        <div
          className="fixed z-50 px-3 py-2 text-sm bg-gray-900 text-white rounded-lg shadow-lg pointer-events-none transform -translate-x-1/2 -translate-y-full"
          style={{
            left: tooltip.x,
            top: tooltip.y,
          }}
        >
          <div className="font-medium">{tooltip.entry.title}</div>
          <div className="text-gray-300 text-xs mt-1">
            {Math.floor(tooltip.entry.startHour)}:{String(Math.round((tooltip.entry.startHour % 1) * 60)).padStart(2, '0')} - {Math.floor(tooltip.entry.endHour)}:{String(Math.round((tooltip.entry.endHour % 1) * 60)).padStart(2, '0')}
          </div>
        </div>
      )}

      {/* 空状态 */}
      {persons.length === 0 && (
        <div className="flex items-center justify-center py-12 text-gray-500 dark:text-gray-400">
          <span className="text-sm">暂无人员数据</span>
        </div>
      )}
    </div>
  );
}
