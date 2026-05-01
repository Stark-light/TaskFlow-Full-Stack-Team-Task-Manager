const jwt = require('jsonwebtoken');
const { db } = require('../db/database');

const JWT_SECRET = process.env.JWT_SECRET || 'taskflow_super_secret_key_change_in_prod';

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(decoded.id);
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

function requireProjectAccess(req, res, next) {
  const projectId = req.params.projectId || req.params.id;
  const member = db.prepare(
    'SELECT * FROM project_members WHERE project_id = ? AND user_id = ?'
  ).get(projectId, req.user.id);

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  if (req.user.role === 'admin' || member || project.owner_id === req.user.id) {
    req.projectMember = member;
    req.project = project;
    return next();
  }
  return res.status(403).json({ error: 'Access denied to this project' });
}

function requireProjectAdmin(req, res, next) {
  const projectId = req.params.projectId || req.params.id;
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  if (req.user.role === 'admin' || project.owner_id === req.user.id) {
    req.project = project;
    return next();
  }
  const member = db.prepare(
    'SELECT * FROM project_members WHERE project_id = ? AND user_id = ? AND role = ?'
  ).get(projectId, req.user.id, 'admin');
  if (!member) return res.status(403).json({ error: 'Project admin access required' });
  req.project = project;
  next();
}

module.exports = { authenticate, requireAdmin, requireProjectAccess, requireProjectAdmin, JWT_SECRET };
