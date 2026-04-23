import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/mongodb';
import { Person } from '@/lib/models/Person';
import { TimeEntry } from '@/lib/models/TimeEntry';

// DELETE /api/persons/[id] - 删除人员（同时删除其所有时间记录）
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await connectDB();
  const { id } = await params;
  await TimeEntry.deleteMany({ personId: id });
  await Person.findByIdAndDelete(id);
  return NextResponse.json({ success: true });
}
