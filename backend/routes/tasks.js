const express = require('express');
const router = express.Router({ mergeParams: true });
const { body, validationResult } = require('express-validator');
const { db } = require('../db/database');
const { authenticate, requireProjectAccess } = require('../middleware/auth');

// GET /api/projects/:projectId/tasks
router.get('/', authenticate, requireProjectAccess, (req, res) => {
  const { status, priority, assignee_id } = req.query;
  let query = `
    SELECT t.*, 
      u1.name as assignee_name, u1.email as assignee_email,
      u2.name as creator_name
    FROM tasks t
    LEFT JOIN users u1 ON t.assignee_id = u1.id
    LEFT JOIN users u2 ON t.created_by = u2.id
    WHERE t.project_id = ?
  `;
  const params = [req.params.projectId];

  if (status) { query += ' AND t.status = ?'; params.push(status); }
  if (priority) { query += ' AND t.priority = ?'; params.push(priority); }
  if (assignee_id) { query += ' AND t.assignee_id = ?'; params.push(assignee_id); }

  query += ' ORDER BY CASE t.priority WHEN "urgent" THEN 1 WHEN "high" THEN 2 WHEN "medium" THEN 3 WHEN "low" THEN 4 END, t.due_date ASC NULLS LAST, t.created_at DESC';

  const tasks = db.prepare(query).all(...params);
  res.json({ tasks });
});

// POST /api/projects/:projectId/tasks
router.post('/', authenticate, requireProjectAccess, [
  body('title').trim().isLength({ min: 2 }).withMessage('Title required'),
  body('description').optional().trim(),
  body('status').optional().isIn(['todo', 'in_progress', 'review', 'done']),
  body('priority').optional().isIn(['low', 'medium', 'high', 'urgent']),
  body('assignee_id').optional({ nullable: true }).isInt(),
  body('due_date').optional({ nullable: true }).isISO8601(),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { title, description, status = 'todo', priority = 'medium', assignee_id, due_date } = req.body;

  if (assignee_id) {
    const member = db.prepare(
      'SELECT * FROM project_members WHERE project_id = ? AND user_id = ?'
    ).get(req.params.projectId, assignee_id);
    if (!member) return res.status(400).json({ error: 'Assignee must be a project member' });
  }

  const result = db.prepare(`
    INSERT INTO tasks (title, description, status, priority, project_id, assignee_id, created_by, due_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(title, description || null, status, priority, req.params.projectId, assignee_id || null, req.user.id, due_date || null);

  const task = db.prepare(`
    SELECT t.*, u1.name as assignee_name, u2.name as creator_name
    FROM tasks t LEFT JOIN users u1 ON t.assignee_id = u1.id LEFT JOIN users u2 ON t.created_by = u2.id
    WHERE t.id = ?
  `).get(result.lastInsertRowid);

  res.status(201).json({ task });
});

// GET /api/projects/:projectId/tasks/:taskId
router.get('/:taskId', authenticate, requireProjectAccess, (req, res) => {
  const task = db.prepare(`
    SELECT t.*, u1.name as assignee_name, u1.email as assignee_email, u2.name as creator_name
    FROM tasks t LEFT JOIN users u1 ON t.assignee_id = u1.id LEFT JOIN users u2 ON t.created_by = u2.id
    WHERE t.id = ? AND t.project_id = ?
  `).get(req.params.taskId, req.params.projectId);

  if (!task) return res.status(404).json({ error: 'Task not found' });

  const comments = db.prepare(`
    SELECT c.*, u.name as user_name, u.email as user_email
    FROM comments c JOIN users u ON c.user_id = u.id
    WHERE c.task_id = ? ORDER BY c.created_at ASC
  `).all(req.params.taskId);

  res.json({ task, comments });
});

// PUT /api/projects/:projectId/tasks/:taskId
router.put('/:taskId', authenticate, requireProjectAccess, [
  body('title').optional().trim().isLength({ min: 2 }),
  body('description').optional({ nullable: true }),
  body('status').optional().isIn(['todo', 'in_progress', 'review', 'done']),
  body('priority').optional().isIn(['low', 'medium', 'high', 'urgent']),
  body('assignee_id').optional({ nullable: true }),
  body('due_date').optional({ nullable: true }).isISO8601(),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND project_id = ?').get(req.params.taskId, req.params.projectId);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  // members can only update their own tasks or tasks assigned to them, unless project admin
  const isProjectAdmin = req.user.role === 'admin' || req.project.owner_id === req.user.id;
  const isMemberAdmin = db.prepare(
    'SELECT * FROM project_members WHERE project_id = ? AND user_id = ? AND role = ?'
  ).get(req.params.projectId, req.user.id, 'admin');

  if (!isProjectAdmin && !isMemberAdmin && task.created_by !== req.user.id && task.assignee_id !== req.user.id) {
    return res.status(403).json({ error: 'Not authorized to edit this task' });
  }

  const { title, description, status, priority, assignee_id, due_date } = req.body;
  db.prepare(`
    UPDATE tasks SET
      title = COALESCE(?, title),
      description = COALESCE(?, description),
      status = COALESCE(?, status),
      priority = COALESCE(?, priority),
      assignee_id = ?,
      due_date = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    title || null, description || null, status || null, priority || null,
    assignee_id !== undefined ? (assignee_id || null) : task.assignee_id,
    due_date !== undefined ? (due_date || null) : task.due_date,
    req.params.taskId
  );

  const updated = db.prepare(`
    SELECT t.*, u1.name as assignee_name, u2.name as creator_name
    FROM tasks t LEFT JOIN users u1 ON t.assignee_id = u1.id LEFT JOIN users u2 ON t.created_by = u2.id
    WHERE t.id = ?
  `).get(req.params.taskId);

  res.json({ task: updated });
});

// DELETE /api/projects/:projectId/tasks/:taskId
router.delete('/:taskId', authenticate, requireProjectAccess, (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND project_id = ?').get(req.params.taskId, req.params.projectId);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const isProjectAdmin = req.user.role === 'admin' || req.project.owner_id === req.user.id;
  const isMemberAdmin = db.prepare(
    'SELECT * FROM project_members WHERE project_id = ? AND user_id = ? AND role = ?'
  ).get(req.params.projectId, req.user.id, 'admin');

  if (!isProjectAdmin && !isMemberAdmin && task.created_by !== req.user.id) {
    return res.status(403).json({ error: 'Not authorized to delete this task' });
  }

  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.taskId);
  res.json({ message: 'Task deleted' });
});

// POST /api/projects/:projectId/tasks/:taskId/comments
router.post('/:taskId/comments', authenticate, requireProjectAccess, [
  body('content').trim().isLength({ min: 1 }).withMessage('Comment content required'),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const task = db.prepare('SELECT id FROM tasks WHERE id = ? AND project_id = ?').get(req.params.taskId, req.params.projectId);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const result = db.prepare(
    'INSERT INTO comments (task_id, user_id, content) VALUES (?, ?, ?)'
  ).run(req.params.taskId, req.user.id, req.body.content);

  const comment = db.prepare(`
    SELECT c.*, u.name as user_name FROM comments c JOIN users u ON c.user_id = u.id WHERE c.id = ?
  `).get(result.lastInsertRowid);

  res.status(201).json({ comment });
});

module.exports = router;