import mongoose from 'mongoose';

const MONGODB_URI = 'mongodb://admin:Mongo%402026!@82.157.107.78:27017/admin';

interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

declare global {
  var mongoose: MongooseCache | undefined;
}

if (!global.mongoose) {
  global.mongoose = { conn: null, promise: null };
}

const cached: MongooseCache = global.mongoose!;

export async function connectDB() {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    cached.promise = mongoose.connect(MONGODB_URI, {
      dbName: 'timemanager',
    });
  }
  cached.conn = await cached.promise;
  return cached.conn;
}
