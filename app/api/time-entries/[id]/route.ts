import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/mongodb';
import { TimeEntry } from '@/lib/models/TimeEntry';

// PUT /api/time-entries/[id] - 更新时间记录
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await connectDB();
  const { id } = await params;
  const body = await request.json();
  if (body.endHour !== undefined && body.startHour !== undefined && body.endHour <= body.startHour) {
    return NextResponse.json({ error: '结束时间必须大于开始时间' }, { status: 400 });
  }
  const entry = await TimeEntry.findByIdAndUpdate(id, body, { new: true });
  if (!entry) {
    return NextResponse.json({ error: '记录不存在' }, { status: 404 });
  }
  return NextResponse.json({ entry });
}

// DELETE /api/time-entries/[id] - 删除时间记录
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await connectDB();
  const { id } = await params;
  const entry = await TimeEntry.findByIdAndDelete(id);
  if (!entry) {
    return NextResponse.json({ error: '记录不存在' }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
