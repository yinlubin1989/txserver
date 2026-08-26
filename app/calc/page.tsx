import type { Metadata } from "next";
import CalcApp from "./CalcApp";

export const metadata: Metadata = {
  title: "卖花记账 · 计算器",
  description: "每天记录大花、小花、发红包的收支账目。",
};

export default function CalcPage() {
  return <CalcApp />;
}