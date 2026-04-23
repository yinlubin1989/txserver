import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/mongodb';
import { Person } from '@/lib/models/Person';

// GET /api/persons - 获取所有人员
export async function GET() {
  await connectDB();
  const persons = await Person.find().sort({ createdAt: 1 });
  return NextResponse.json({ persons });
}

// POST /api/persons - 创建人员
export async function POST(request: NextRequest) {
  await connectDB();
  const body = await request.json();
  const { name } = body;
  if (!name) {
    return NextResponse.json({ error: '姓名不能为空' }, { status: 400 });
  }
  const person = await Person.create({ name });
  return NextResponse.json({ person }, { status: 201 });
}
