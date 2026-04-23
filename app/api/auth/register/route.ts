import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/mongodb';
import { User } from '@/lib/models/User';
import bcrypt from 'bcryptjs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, email, password } = body;

    if (!username || !email || !password) {
      return NextResponse.json(
        { success: false, error: 'All fields are required' },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { success: false, error: 'Password must be at least 6 characters' },
        { status: 400 }
      );
    }

    await connectDB();

    const existing = await User.findOne({ $or: [{ username }, { email }] });
    if (existing) {
      return NextResponse.json(
        { success: false, error: 'Username or email already exists' },
        { status: 409 }
      );
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({ username, email, password: hashedPassword });

    return NextResponse.json(
      {
        success: true,
        user: {
          id: (user._id as { toString: () => string }).toString(),
          username: user.username,
          email: user.email,
        },
      },
      { status: 201 }
    );
  } catch {
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
