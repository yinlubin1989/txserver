import mongoose from 'mongoose';

const ComicCommentSchema = new mongoose.Schema(
  {
    text: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const ComicReactionSchema = new mongoose.Schema(
  {
    photo: { type: String, required: true, unique: true, index: true },
    likes: { type: Number, default: 0, min: 0 },
    comments: { type: [ComicCommentSchema], default: [] },
  },
  { timestamps: true }
);

ComicReactionSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: function(_doc: unknown, ret: Record<string, unknown>) {
    ret.id = (ret._id as { toString: () => string }).toString();
    delete ret._id;
    return ret;
  }
});

export const ComicReaction =
  mongoose.models.ComicReaction || mongoose.model('ComicReaction', ComicReactionSchema);
