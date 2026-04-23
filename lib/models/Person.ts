import mongoose from 'mongoose';

const PersonSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
  },
  { timestamps: true }
);

PersonSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: function(_doc: unknown, ret: Record<string, unknown>) {
    ret.id = (ret._id as { toString: () => string }).toString();
    delete ret._id;
    return ret;
  }
});

export const Person = mongoose.models.Person || mongoose.model('Person', PersonSchema);
