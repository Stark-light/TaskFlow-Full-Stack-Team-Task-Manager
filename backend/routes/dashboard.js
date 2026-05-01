const express = require('express');
const router = express.Router();
const { db } = require('../db/database');
const { authenticate } = require('../middleware/auth');

// GET /api/dashboard - comprehensive stats
router.get('/', authenticate, (req, res) => {
  const userId = req.user.id;
  const isAdmin = req.user.role === 'admin';

  let myTasks, overdueTasks, tasksByStatus, tasksByPriority, recentActivity, projectStats;

  const today = new Date().toISOString().split('T')[0];

  if (isAdmin) {
    myTasks = db.prepare(`
      SELECT t.*, p.name as project_name, u.name as assignee_name
      FROM tasks t JOIN projects p ON t.project_id = p.id
      LEFT JOIN users u ON t.assignee_id = u.id
      WHERE t.status != 'done'
      ORDER BY t.due_date ASC NULLS LAST LIMIT 10
    `).all();

    overdueTasks = db.prepare(`
      SELECT t.*, p.name as project_name, u.name as assignee_name
      FROM tasks t JOIN projects p ON t.project_id = p.id
      LEFT JOIN users u ON t.assignee_id = u.id
      WHERE t.due_date < ? AND t.status != 'done'
      ORDER BY t.due_date ASC
    `).all(today);

    tasksByStatus = db.prepare(`
      SELECT status, COUNT(*) as count FROM tasks GROUP BY status
    `).all();

    tasksByPriority = db.prepare(`
      SELECT priority, COUNT(*) as count FROM tasks WHERE status != 'done' GROUP BY priority
    `).all();

    projectStats = db.prepare(`
      SELECT p.id, p.name, p.status,
        COUNT(t.id) as total_tasks,
        SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) as done_tasks,
        SUM(CASE WHEN t.due_date < ? AND t.status != 'done' THEN 1 ELSE 0 END) as overdue_tasks,
        COUNT(pm.user_id) as member_count
      FROM projects p
      LEFT JOIN tasks t ON t.project_id = p.id
      LEFT JOIN project_members pm ON pm.project_id = p.id
      GROUP BY p.id ORDER BY p.created_at DESC LIMIT 6
    `).all(today);

  } else {
    myTasks = db.prepare(`
      SELECT t.*, p.name as project_name, u.name as assignee_name
      FROM tasks t JOIN projects p ON t.project_id = p.id
      LEFT JOIN users u ON t.assignee_id = u.id
      WHERE (t.assignee_id = ? OR t.created_by = ?) AND t.status != 'done'
      ORDER BY t.due_date ASC NULLS LAST LIMIT 10
    `).all(userId, userId);

    overdueTasks = db.prepare(`
      SELECT t.*, p.name as project_name
      FROM tasks t JOIN projects p ON t.project_id = p.id
      WHERE (t.assignee_id = ? OR t.created_by = ?) AND t.due_date < ? AND t.status != 'done'
      ORDER BY t.due_date ASC
    `).all(userId, userId, today);

    tasksByStatus = db.prepare(`
      SELECT t.status, COUNT(*) as count FROM tasks t
      WHERE t.assignee_id = ? OR t.created_by = ?
      GROUP BY t.status
    `).all(userId, userId);

    tasksByPriority = db.prepare(`
      SELECT priority, COUNT(*) as count FROM tasks
      WHERE (assignee_id = ? OR created_by = ?) AND status != 'done'
      GROUP BY priority
    `).all(userId, userId);

    projectStats = db.prepare(`
      SELECT p.id, p.name, p.status,
        COUNT(t.id) as total_tasks,
        SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) as done_tasks,
        SUM(CASE WHEN t.due_date < ? AND t.status != 'done' THEN 1 ELSE 0 END) as overdue_tasks
      FROM projects p
      LEFT JOIN tasks t ON t.project_id = p.id
      WHERE p.owner_id = ? OR p.id IN (SELECT project_id FROM project_members WHERE user_id = ?)
      GROUP BY p.id ORDER BY p.created_at DESC LIMIT 6
    `).all(today, userId, userId);
  }

  const totalUsers = isAdmin ? db.prepare('SELECT COUNT(*) as count FROM users').get().count : null;
  const totalProjects = isAdmin ? db.prepare('SELECT COUNT(*) as count FROM projects').get().count : null;

  res.json({
    myTasks,
    overdueTasks,
    tasksByStatus,
    tasksByPriority,
    projectStats,
    totalUsers,
    totalProjects
  });
});

module.exports = router;