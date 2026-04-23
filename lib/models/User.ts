import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      minlength: 2,
      maxlength: 20,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    password: {
      type: String,
      required: true,
      minlength: 6,
    },
  },
  { timestamps: true }
);

UserSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: function (_doc: unknown, ret: Record<string, unknown>) {
    ret.id = (ret._id as { toString: () => string }).toString();
    delete ret._id;
    delete ret.password;
    delete ret.__v;
    return ret;
  },
});

export const User = mongoose.models.User || mongoose.model('User', UserSchema);
