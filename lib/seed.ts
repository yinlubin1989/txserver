import mongoose from 'mongoose';
import { connectDB } from './mongodb';
import { Person } from './models/Person';
import { TimeEntry } from './models/TimeEntry';

const today = new Date().toISOString().split('T')[0];

const personsData = [
  { name: '张三' },
  { name: '李四' },
  { name: '王五' },
];

const timeEntriesData = [
  // 张三
  { title: '项目会议', startHour: 9, endHour: 11.5, color: '#3b82f6' },
  { title: '开发工作', startHour: 14, endHour: 17, color: '#22c55e' },
  // 李四
  { title: '需求分析', startHour: 8.5, endHour: 12, color: '#f97316' },
  { title: '代码评审', startHour: 13, endHour: 18, color: '#a855f7' },
  // 王五
  { title: '培训', startHour: 10, endHour: 12, color: '#ef4444' },
  { title: '1对1', startHour: 15, endHour: 16.5, color: '#eab308' },
  { title: '加班', startHour: 19, endHour: 21, color: '#06b6d4' },
];

export async function seed() {
  await connectDB();

  // 清空已有数据
  await Person.deleteMany({});
  await TimeEntry.deleteMany({});

  // 插入人员
  const persons = await Person.insertMany(personsData);
  console.log(`Inserted ${persons.length} persons`);

  // 创建时间记录
  const timeEntriesWithPersonId = [
    // 张三的记录 (persons[0])
    { ...timeEntriesData[0], personId: persons[0]._id, date: today },
    { ...timeEntriesData[1], personId: persons[0]._id, date: today },
    // 李四的记录 (persons[1])
    { ...timeEntriesData[2], personId: persons[1]._id, date: today },
    { ...timeEntriesData[3], personId: persons[1]._id, date: today },
    // 王五的记录 (persons[2])
    { ...timeEntriesData[4], personId: persons[2]._id, date: today },
    { ...timeEntriesData[5], personId: persons[2]._id, date: today },
    { ...timeEntriesData[6], personId: persons[2]._id, date: today },
  ];

  const timeEntries = await TimeEntry.insertMany(timeEntriesWithPersonId);
  console.log(`Inserted ${timeEntries.length} time entries`);

  await mongoose.disconnect();
  console.log('Seed completed!');
}

seed().catch((error) => {
  console.error('Seed error:', error);
  process.exit(1);
});
