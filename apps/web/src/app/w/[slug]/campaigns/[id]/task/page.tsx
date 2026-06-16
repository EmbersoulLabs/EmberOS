"use client";

import { Suspense } from "react";
import TaskProgressContent from "./TaskProgressContent";

export default function TaskProgressPage() {
  return (
    <Suspense fallback={<p className="p-6 text-slate-500">Loading...</p>}>
      <TaskProgressContent />
    </Suspense>
  );
}
