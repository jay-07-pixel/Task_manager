-- Allow dismissing stale postpone requests (task completed / submitted / no longer overdue).
ALTER TABLE `task_deadline_extension_request`
  MODIFY `status` ENUM('pending', 'approved', 'cancelled') NOT NULL DEFAULT 'pending';
