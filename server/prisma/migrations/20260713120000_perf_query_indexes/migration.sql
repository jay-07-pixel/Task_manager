-- CreateIndex
CREATE INDEX `TaskList_owner_id_idx` ON `TaskList`(`owner_id`);

-- CreateIndex
CREATE INDEX `Task_list_id_completed_idx` ON `Task`(`list_id`, `completed`);

-- CreateIndex
CREATE INDEX `task_assignee_assigned_by_user_id_idx` ON `task_assignee`(`assigned_by_user_id`);
