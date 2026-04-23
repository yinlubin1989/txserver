import mongoose from 'mongoose';

const TimeEntrySchema = new mongoose.Schema(
  {
    personId: { type: mongoose.Schema.Types.ObjectId, ref: 'Person', required: true },
    title: { type: String, required: true },
    startHour: { type: Number, required: true },
    endHour: { type: Number, required: true },
    color: { type: String, default: '#3b82f6' },
    date: { type: String, required: true },
  },
  { timestamps: true }
);

TimeEntrySchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: function(_doc: unknown, ret: Record<string, unknown>) {
    ret.id = (ret._id as { toString: () => string }).toString();
    delete ret._id;
    return ret;
  }
});

export const TimeEntry = mongoose.models.TimeEntry || mongoose.model('TimeEntry', TimeEntrySchema);
