"use client";

import { Suspense } from "react";
import TaskProgressContent from "./TaskProgressContent";
import { TaskPageLoading } from "./TaskPageLoading";

export default function TaskProgressPage() {
  return (
    <Suspense fallback={<TaskPageLoading />}>
      <TaskProgressContent />
    </Suspense>
  );
}
