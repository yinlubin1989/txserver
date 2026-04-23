import mongoose from 'mongoose';

const UploadSchema = new mongoose.Schema(
  {
    originalName: { type: String, required: true },
    filename: { type: String, required: true, unique: true },
    url: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
  },
  { timestamps: true }
);

UploadSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: function(_doc: unknown, ret: Record<string, unknown>) {
    ret.id = (ret._id as { toString: () => string }).toString();
    delete ret._id;
    return ret;
  }
});

export const Upload = mongoose.models.Upload || mongoose.model('Upload', UploadSchema);
