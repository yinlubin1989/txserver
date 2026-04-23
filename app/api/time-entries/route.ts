import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/mongodb';
import { TimeEntry } from '@/lib/models/TimeEntry';

// GET /api/time-entries?date=YYYY-MM-DD - 获取指定日期的时间记录
export async function GET(request: NextRequest) {
  await connectDB();
  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date');
  if (!date) {
    return NextResponse.json({ error: '请提供日期参数' }, { status: 400 });
  }
  const entries = await TimeEntry.find({ date }).sort({ startHour: 1 });
  return NextResponse.json({ entries });
}

// POST /api/time-entries - 创建时间记录
export async function POST(request: NextRequest) {
  await connectDB();
  const body = await request.json();
  const { personId, title, startHour, endHour, color, date } = body;
  if (!personId || !title || startHour === undefined || endHour === undefined || !date) {
    return NextResponse.json({ error: '缺少必填字段' }, { status: 400 });
  }
  if (endHour <= startHour) {
    return NextResponse.json({ error: '结束时间必须大于开始时间' }, { status: 400 });
  }
  const entry = await TimeEntry.create({ personId, title, startHour, endHour, color: color || '#3b82f6', date });
  return NextResponse.json({ entry }, { status: 201 });
}
