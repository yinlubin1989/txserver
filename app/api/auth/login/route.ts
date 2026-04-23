import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/mongodb';
import { User } from '@/lib/models/User';
import bcrypt from 'bcryptjs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { login, password } = body;

    if (!login || !password) {
      return NextResponse.json(
        { success: false, error: 'Login and password are required' },
        { status: 400 }
      );
    }

    await connectDB();

    const user = await User.findOne({ $or: [{ username: login }, { email: login }] });
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Invalid credentials' },
        { status: 401 }
      );
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return NextResponse.json(
        { success: false, error: 'Invalid credentials' },
        { status: 401 }
      );
    }

    return NextResponse.json({
      success: true,
      user: {
        id: (user._id as { toString: () => string }).toString(),
        username: user.username,
        email: user.email,
      },
    });
  } catch {
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
